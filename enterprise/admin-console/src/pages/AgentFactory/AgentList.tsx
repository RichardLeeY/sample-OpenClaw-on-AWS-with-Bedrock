import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Plus, Users, Star, Zap, Edit3, Play, Settings, Eye, Search, Filter } from 'lucide-react';
import { Card, StatCard, Badge, Button, PageHeader, Table as DataTable, Modal, Input, Select, StatusDot, Tabs } from '../../components/ui';
import { useAgents, usePositions, useEmployees, useCreateAgent } from '../../hooks/useApi';
import { CHANNEL_LABELS } from '../../types';
import type { Agent, ChannelType } from '../../types';

export default function AgentList() {
  const navigate = useNavigate();
  const { data: AGENTS = [], isLoading } = useAgents();
  const { data: POSITIONS = [] } = usePositions();
  const { data: EMPLOYEES = [] } = useEmployees();
  const createAgent = useCreateAgent();
  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState(0);
  const [newName, setNewName] = useState('');
  const [newPos, setNewPos] = useState('');
  const [newEmp, setNewEmp] = useState('');
  const [newChannels, setNewChannels] = useState<string[]>(['slack']);
  const [filterText, setFilterText] = useState('');
  const [filterDept, setFilterDept] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [activeTab, setActiveTab] = useState('personal');

  const posOptions = POSITIONS.map(p => ({ label: p.name, value: p.id }));
  const empOptions = EMPLOYEES.filter(e => !e.agentId).map(e => ({ label: `${e.name} (${e.positionName})`, value: e.id }));
  const avgQuality = AGENTS.filter(a => a.qualityScore).reduce((s, a) => s + (a.qualityScore || 0), 0) / AGENTS.filter(a => a.qualityScore).length;

  const personalAgents = AGENTS.filter(a => a.employeeId !== null);
  const sharedAgents = AGENTS.filter(a => a.employeeId === null);

  const currentList = activeTab === 'personal' ? personalAgents : activeTab === 'shared' ? sharedAgents : AGENTS;

  // Unique departments from agents
  const deptSet = new Set(AGENTS.map(a => a.positionName));
  const deptOptions = [{ label: 'All Positions', value: 'all' }, ...Array.from(deptSet).map(d => ({ label: d, value: d }))];

  const filtered = currentList.filter(a => {
    const matchText = !filterText || a.name.toLowerCase().includes(filterText.toLowerCase()) || a.employeeName.toLowerCase().includes(filterText.toLowerCase()) || a.positionName.toLowerCase().includes(filterText.toLowerCase());
    const matchDept = filterDept === 'all' || a.positionName === filterDept;
    const matchStatus = filterStatus === 'all' || a.status === filterStatus;
    return matchText && matchDept && matchStatus;
  });

  return (
    <div>
      <PageHeader
        title="Agent Factory"
        description={`${AGENTS.length} agents across ${POSITIONS.length} positions · ${EMPLOYEES.filter(e => !e.agentId).length} employees unbound`}
        actions={<Button variant="primary" onClick={() => { setShowCreate(true); setCreateStep(0); }}><Plus size={16} /> Create Agent</Button>}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5 mb-6">
        <StatCard title="Total Agents" value={AGENTS.length} icon={<Bot size={22} />} color="primary" />
        <StatCard title="Personal (1:1)" value={personalAgents.length} icon={<Users size={22} />} color="info" />
        <StatCard title="Shared (N:1)" value={sharedAgents.length} icon={<Users size={22} />} color="cyan" />
        <StatCard title="Active" value={AGENTS.filter(a => a.status === 'active').length} icon={<Zap size={22} />} color="success" />
        <StatCard title="Avg Quality" value={`⭐ ${avgQuality.toFixed(1)}`} icon={<Star size={22} />} color="warning" />
      </div>

      <Card>
        <Tabs
          tabs={[
            { id: 'personal', label: 'Personal Agents', count: personalAgents.length },
            { id: 'shared', label: 'Shared / Team Agents', count: sharedAgents.length },
            { id: 'all', label: 'All', count: AGENTS.length },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
        />

        {/* Filters */}
        <div className="mt-4 mb-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text" value={filterText} onChange={e => setFilterText(e.target.value)}
              placeholder="Search agent, employee, position..."
              className="w-full rounded-lg border border-dark-border bg-dark-bg py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none"
            />
          </div>
          <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none appearance-none">
            {deptOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none appearance-none">
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="idle">Idle</option>
            <option value="error">Error</option>
          </select>
          <Badge color="info">{filtered.length} agents</Badge>
        </div>

        <DataTable
          columns={[
            { key: 'name', label: 'Agent', render: (a: Agent) => (
              <div className="flex items-center gap-3">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${a.employeeId ? 'bg-primary/10 text-primary' : 'bg-cyan/10 text-cyan'}`}>
                  <Bot size={16} />
                </div>
                <div>
                  <button onClick={() => navigate(`/agents/${a.id}`)} className="text-sm font-medium text-primary-light hover:underline">{a.name}</button>
                  <p className="text-xs text-text-muted">{a.employeeId ? '1:1 Personal' : 'N:1 Shared'}</p>
                </div>
              </div>
            )},
            { key: 'employee', label: 'Employee', render: (a: Agent) => <span className="text-sm">{a.employeeName}</span> },
            { key: 'position', label: 'Position', render: (a: Agent) => <Badge>{a.positionName}</Badge> },
            { key: 'channels', label: 'Channels', render: (a: Agent) => (
              <div className="flex flex-wrap gap-1">{a.channels.map(c => <Badge key={c} color="info">{CHANNEL_LABELS[c as ChannelType]}</Badge>)}</div>
            )},
            { key: 'skills', label: 'Skills', render: (a: Agent) => <span className="text-sm text-text-secondary">{a.skills.length}</span> },
            { key: 'quality', label: 'Quality', render: (a: Agent) => (
              <span className={`text-sm font-medium ${(a.qualityScore || 0) >= 4.5 ? 'text-success' : (a.qualityScore || 0) >= 4.0 ? 'text-warning' : 'text-danger'}`}>
                ⭐ {a.qualityScore?.toFixed(1) || '—'}
              </span>
            )},
            { key: 'soul', label: 'SOUL', render: (a: Agent) => (
              <div className="flex gap-1 text-xs">
                <span className="text-text-muted">G:v{a.soulVersions.global}</span>
                <span className="text-primary">P:v{a.soulVersions.position}</span>
                <span className="text-success">U:v{a.soulVersions.personal}</span>
              </div>
            )},
            { key: 'status', label: 'Status', render: (a: Agent) => <StatusDot status={a.status} /> },
            { key: 'updated', label: 'Updated', render: (a: Agent) => <span className="text-xs text-text-muted">{new Date(a.updatedAt).toLocaleDateString()}</span> },
            { key: 'actions', label: '', render: (a: Agent) => (
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => navigate(`/agents/${a.id}`)}><Eye size={14} /></Button>
                <Button variant="ghost" size="sm" onClick={() => navigate(`/agents/${a.id}/soul`)}><Edit3 size={14} /></Button>
              </div>
            )},
          ]}
          data={filtered}
        />
      </Card>

      {/* Create Agent Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create Agent" size="lg"
        footer={
          <div className="flex justify-between">
            <div className="flex gap-1">
              {[0, 1, 2].map(i => (
                <div key={i} className={`h-1.5 w-8 rounded-full ${i <= createStep ? 'bg-primary' : 'bg-dark-border'}`} />
              ))}
            </div>
            <div className="flex gap-3">
              {createStep > 0 && <Button variant="default" onClick={() => setCreateStep(s => s - 1)}>Back</Button>}
              {createStep < 2 ? (
                <Button variant="primary" onClick={() => setCreateStep(s => s + 1)}>Next</Button>
              ) : (
                <Button variant="primary" onClick={() => {
                  if (newName && newPos) {
                    const pos = POSITIONS.find(p => p.id === newPos);
                    const emp = EMPLOYEES.find(e => e.id === newEmp);
                    createAgent.mutate({
                      name: newName,
                      employeeId: newEmp || null,
                      employeeName: emp?.name || '',
                      positionId: newPos,
                      positionName: pos?.name || '',
                      channels: [],
                      skills: pos?.defaultSkills || [],
                    } as any);
                  }
                  setShowCreate(false); setNewName(''); setNewPos(''); setNewEmp(''); setCreateStep(0);
                }}>Create Agent</Button>
              )}
            </div>
          </div>
        }
      >
        {createStep === 0 && (
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-text-primary">Step 1: Basic Configuration</h4>
            <Select label="Position Template" value={newPos} onChange={v => {
              setNewPos(v);
              // Auto-generate name when position changes
              const pos = POSITIONS.find(p => p.id === v);
              const emp = EMPLOYEES.find(e => e.id === newEmp);
              if (pos && emp) setNewName(`${pos.name} Agent - ${emp.name}`);
              else if (pos) setNewName(`${pos.name} Agent`);
            }} options={posOptions} placeholder="Select position" description="Inherits SOUL, Skills, and tool permissions" />
            <Select label="Bind Employee" value={newEmp} onChange={v => {
              setNewEmp(v);
              // Auto-generate name when employee changes
              const pos = POSITIONS.find(p => p.id === newPos);
              const emp = EMPLOYEES.find(e => e.id === v);
              if (pos && emp) setNewName(`${pos.name} Agent - ${emp.name}`);
            }} options={empOptions} placeholder="Select employee (only showing unbound)" />
            <Input label="Agent Name" value={newName} onChange={setNewName} placeholder="Auto-generated from position + employee" description="Auto-filled — edit if you want a custom name" />
          </div>
        )}
        {createStep === 1 && (
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-text-primary">Step 2: SOUL Preview</h4>
            <div className="rounded-lg bg-info/5 border border-info/20 p-3 text-sm text-info">
              You can fine-tune the three-layer SOUL configuration in the SOUL Editor after creation
            </div>
            {newPos && (
              <>
                <div>
                  <p className="text-xs text-text-muted mb-2">Position SOUL Template</p>
                  <pre className="rounded-lg bg-dark-bg border-l-2 border-primary p-4 text-sm text-text-secondary whitespace-pre-wrap font-mono">
                    {POSITIONS.find(p => p.id === newPos)?.soulTemplate || '(empty)'}
                  </pre>
                </div>
                <div>
                  <p className="text-xs text-text-muted mb-2">Inherited Skills</p>
                  <div className="flex flex-wrap gap-1">
                    {(POSITIONS.find(p => p.id === newPos)?.defaultSkills || []).map(s => <Badge key={s} color="success">{s}</Badge>)}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
        {createStep === 2 && (
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-text-primary">Step 3: Review & Create</h4>
            <div className="grid grid-cols-2 gap-4 rounded-lg bg-dark-bg p-4">
              <div><p className="text-xs text-text-muted">Agent Name</p><p className="text-sm font-medium">{newName || '(not set)'}</p></div>
              <div><p className="text-xs text-text-muted">Position</p><p className="text-sm font-medium">{POSITIONS.find(p => p.id === newPos)?.name || '(not selected)'}</p></div>
              <div><p className="text-xs text-text-muted">Employee</p><p className="text-sm font-medium">{EMPLOYEES.find(e => e.id === newEmp)?.name || '(not selected)'}</p></div>
              <div><p className="text-xs text-text-muted">Mode</p><p className="text-sm font-medium">From position template</p></div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
