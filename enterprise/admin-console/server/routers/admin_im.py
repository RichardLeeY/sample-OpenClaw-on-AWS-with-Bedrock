"""
Admin — IM Channels Management.

Endpoints:
  /api/v1/admin/im-channel-connections
  /api/v1/admin/im-channels
  /api/v1/internal/im-binding-check
  /api/v1/admin/im-channels/{channel}/test
"""

import os
import json
import time as _time
import subprocess

import boto3

from fastapi import APIRouter, HTTPException, Header

import db
from shared import require_role, ssm_client, GATEWAY_REGION, STACK_NAME

router = APIRouter(tags=["admin-im"])

_OPENCLAW_BIN = "/home/ubuntu/.nvm/versions/node/v22.22.2/bin/openclaw"
_OPENCLAW_ENV = "/home/ubuntu/.nvm/versions/node/v22.22.2/bin:/usr/local/bin:/usr/bin:/bin"

# Simple TTL cache for channel status (avoid repeated LLM calls)
_channel_cache: dict = {"data": [], "ts": 0}
_CACHE_TTL = 60  # seconds


# Import mapping helpers from main at call time to avoid circular imports
def _mapping_prefix():
    stack = os.environ.get("STACK_NAME", "openclaw-multitenancy")
    return f"/openclaw/{stack}/user-mapping/"


def _run_openclaw_channels() -> list:
    """Run openclaw channels status --probe and use LLM to parse into structured JSON.
    Returns: [{"channel": "feishu", "status": "connected"|"configured"|"not_connected",
               "protocol": "webhook"|"websocket"|"unknown"}, ...]
    Results are cached for 60s to avoid repeated LLM calls."""
    now = _time.time()
    if _channel_cache["data"] and (now - _channel_cache["ts"]) < _CACHE_TTL:
        return _channel_cache["data"]

    try:
        result = subprocess.run(
            ["sudo", "-u", "ubuntu", "env", f"PATH={_OPENCLAW_ENV}", "HOME=/home/ubuntu",
             _OPENCLAW_BIN, "channels", "status", "--probe"],
            capture_output=True, text=True, timeout=30,
        )
        stdout = result.stdout.strip()
        if not stdout:
            return []

        bedrock = boto3.client("bedrock-runtime", region_name=GATEWAY_REGION)
        resp = bedrock.converse(
            modelId="us.amazon.nova-lite-v1:0",
            messages=[{
                "role": "user",
                "content": [{"text": f"""Parse this CLI output and return ONLY a JSON array. No explanation, no markdown fences.
Only parse channel status lines (starting with "- ") after "Checking channel status" — ignore plugin registration logs, warnings, and tips.
Each element: {{"channel": "<name>", "status": "connected"|"configured"|"not_connected", "protocol": "webhook"|"websocket"|"unknown"}}

Rules for channel name:
- Lowercase, strip the word "default" and any extra whitespace (e.g. "Feishu default" -> "feishu", "Telegram default" -> "telegram")

Rules for status:
- "connected" = running + works (fully operational)
- "configured" = configured but not linked, or stopped
- "not_connected" = not configured, or error states

Rules for protocol:
- feishu -> "webhook"
- lark -> "websocket"
- telegram, discord, whatsapp -> "webhook"
- anything else -> "unknown"

Output to parse:
{stdout}"""}],
            }],
            inferenceConfig={"maxTokens": 256, "temperature": 0},
        )

        text = resp["output"]["message"]["content"][0]["text"]
        start = text.find("[")
        end = text.rfind("]") + 1
        if start != -1 and end > start:
            channels = json.loads(text[start:end])
            _channel_cache["data"] = channels
            _channel_cache["ts"] = now
            return channels
    except Exception as e:
        print(f"[channel-parse] Error: {e}")
    return []


def _list_user_mappings() -> list:
    """List all user mappings — DynamoDB primary, SSM fallback."""
    ddb = db.get_user_mappings()
    if ddb:
        return ddb
    # SSM fallback for fresh deploys before migration runs
    prefix = _mapping_prefix()
    try:
        ssm = ssm_client()
        mappings = []
        params = {"Path": prefix, "Recursive": True, "MaxResults": 10}
        while True:
            resp = ssm.get_parameters_by_path(**params)
            for p in resp.get("Parameters", []):
                name = p["Name"].replace(prefix, "")
                parts = name.split("__", 1)
                if len(parts) == 2:
                    mappings.append({
                        "channel": parts[0],
                        "channelUserId": parts[1],
                        "employeeId": p["Value"],
                        "lastModified": str(p.get("LastModifiedDate", "")),
                    })
            token = resp.get("NextToken")
            if not token:
                break
            params["NextToken"] = token
        return mappings
    except Exception:
        return []


@router.get("/api/v1/admin/im-channel-connections")
def get_im_channel_connections(authorization: str = Header(default="")):
    """Per-channel employee connection table for admin management."""
    require_role(authorization, roles=["admin"])
    try:
        # 1. Get all SSM user-mapping params
        raw_mappings = _list_user_mappings()
        print(f"[im-connections] _list_user_mappings returned {len(raw_mappings)} entries")

        # 2. Employee lookup
        emps = db.get_employees()
        emp_map = {e["id"]: e for e in emps}
        print(f"[im-connections] {len(emps)} employees loaded")

        # 3. Session counts from audit log (lightweight: limit 500)
        session_counts: dict = {}
        last_active: dict = {}
        try:
            audit = db.get_audit_entries(limit=500)
            for a in audit:
                eid = a.get("actorId", "")
                if eid and a.get("eventType") == "agent_invocation":
                    session_counts[eid] = session_counts.get(eid, 0) + 1
                    ts = a.get("timestamp", "")
                    if ts > last_active.get(eid, ""):
                        last_active[eid] = ts
        except Exception as ae:
            print(f"[im-connections] audit fetch failed (non-fatal): {ae}")

        # 4. Group by channel — skip unknown/unkn prefixes
        by_channel: dict = {}
        for m in raw_mappings:
            channel = m.get("channel", "")
            if channel in ("unknown", "unkn") or not channel:
                continue
            emp_id = m.get("employeeId", "")
            emp = emp_map.get(emp_id)
            if not emp:
                continue
            channel_user_id = m.get("channelUserId", "")
            by_channel.setdefault(channel, []).append({
                "empId": emp_id,
                "empName": emp.get("name", emp_id),
                "positionName": emp.get("positionName", ""),
                "departmentName": emp.get("departmentName", ""),
                "channelUserId": channel_user_id,
                "connectedAt": m.get("lastModified", ""),
                "sessionCount": session_counts.get(emp_id, 0),
                "lastActive": last_active.get(emp_id, ""),
            })

        print(f"[im-connections] result channels: {list(by_channel.keys())}, total: {sum(len(v) for v in by_channel.values())}")
        return {"connections": by_channel}

    except Exception as e:
        print(f"[im-connections] ERROR: {e}")
        import traceback
        traceback.print_exc()
        return {"connections": {}, "error": str(e)}


@router.get("/api/v1/admin/im-channels")
def get_im_channels(authorization: str = Header(default="")):
    """Get live IM channel status from Gateway + SSM mappings count per channel."""
    require_role(authorization, roles=["admin", "manager"])
    ssm = boto3.client("ssm", region_name=GATEWAY_REGION)

    # Get all user mappings to count per channel
    channel_counts: dict = {}
    try:
        prefix = _mapping_prefix()
        resp = ssm.get_parameters_by_path(Path=prefix, Recursive=True, MaxResults=10)
        for p in resp.get("Parameters", []):
            name = p["Name"].replace(prefix, "")
            for ch in ["telegram", "discord", "slack", "whatsapp", "feishu", "dingtalk", "teams", "googlechat"]:
                if name.startswith(f"{ch}__"):
                    channel_counts[ch] = channel_counts.get(ch, 0) + 1
                    break
            else:
                # Bare user_id mappings — count but don't attribute to a channel
                pass
    except Exception:
        pass

    # Get live Gateway channel status (LLM-parsed)
    gateway_channels = _run_openclaw_channels()

    # Build enriched channel list
    all_channels = [
        {"id": "telegram",   "label": "Telegram",          "enterprise": True},
        {"id": "discord",    "label": "Discord",            "enterprise": True},
        {"id": "slack",      "label": "Slack",              "enterprise": True},
        {"id": "teams",      "label": "Microsoft Teams",    "enterprise": True},
        {"id": "feishu",     "label": "Feishu / Lark",      "enterprise": True},
        {"id": "dingtalk",   "label": "DingTalk",           "enterprise": True},
        {"id": "googlechat", "label": "Google Chat",        "enterprise": True},
        {"id": "whatsapp",   "label": "WhatsApp",           "enterprise": True},
        {"id": "wechat",     "label": "WeChat",             "enterprise": False},
    ]

    gw_by_channel = {ch["channel"]: ch for ch in gateway_channels}
    result = []
    for ch in all_channels:
        gw = gw_by_channel.get(ch["id"], {})
        status = gw.get("status", "not_connected") if gw else "not_connected"
        result.append({
            **ch,
            "status": status,
            "protocol": gw.get("protocol", "unknown") if gw else "unknown",
            "connectedEmployees": channel_counts.get(ch["id"], 0),
        })
    return result


@router.get("/api/v1/internal/im-binding-check")
def im_binding_check(channel: str, channelUserId: str):
    """Internal endpoint called by H2 Proxy before routing each IM message.
    Strict enforcement: only respond to IM accounts that have a valid employee binding.
    No auth required — only accessible from the same EC2 (internal network)."""
    # Primary: DynamoDB channel-specific lookup
    m = db.get_user_mapping(channel, channelUserId)
    if m and m.get("employeeId"):
        return {"bound": True, "employeeId": m["employeeId"]}
    # Fallback: scan MAPPING# for bare channelUserId (Feishu OU IDs, etc.)
    try:
        from boto3.dynamodb.conditions import Key as _KBC, Attr as _ABC
        ddb = boto3.resource("dynamodb", region_name=os.environ.get("DYNAMODB_REGION", "us-east-2"))
        table = ddb.Table(os.environ.get("DYNAMODB_TABLE", "openclaw-enterprise"))
        resp = table.query(
            KeyConditionExpression=_KBC("PK").eq("ORG#acme") & _KBC("SK").begins_with("MAPPING#"),
            FilterExpression=_ABC("channelUserId").eq(channelUserId),
        )
        if resp.get("Items"):
            return {"bound": True, "employeeId": resp["Items"][0]["employeeId"]}
    except Exception:
        pass
    return {"bound": False}


@router.post("/api/v1/admin/im-channels/{channel}/test")
def test_im_channel(channel: str, authorization: str = Header(default="")):
    """Test bot connection by checking LLM-parsed channel status.
    Forces a fresh probe (bypasses cache). Returns {ok, botName, protocol, error}."""
    require_role(authorization, roles=["admin"])
    # Clear cache to force a fresh probe
    _channel_cache["ts"] = 0
    channels = _run_openclaw_channels()
    ch_key = channel.lower()
    for ch in channels:
        if ch.get("channel") == ch_key:
            if ch["status"] == "connected":
                return {"ok": True, "botName": ch_key, "protocol": ch.get("protocol", "unknown")}
            return {
                "ok": False,
                "error": f"{channel.capitalize()} bot status: {ch['status']}. Open Gateway UI (port 18789) → Channels → configure {channel.capitalize()}.",
            }
    return {
        "ok": False,
        "error": f"{channel.capitalize()} bot not configured in OpenClaw. Open Gateway UI (port 18789) → Channels → Add {channel.capitalize()}.",
    }
