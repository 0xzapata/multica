"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Zap,
  Plus,
  Play,
  Pause,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Trash2,
  MoreHorizontal,
  ChevronDown,
  AlertCircle,
} from "lucide-react";
import type {
  Agentflow,
  AgentflowTrigger,
  AgentflowRun,
  Agent,
  CreateAgentflowRequest,
  TaskMessagePayload,
} from "@/shared/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useAgentflowStore } from "@/features/agentflows";
import { useWorkspaceStore } from "@/features/workspace";
import { api } from "@/shared/api";

// ---------------------------------------------------------------------------
// Run status config
// ---------------------------------------------------------------------------

const runStatusConfig: Record<string, { label: string; icon: typeof CheckCircle2; color: string }> = {
  pending: { label: "Pending", icon: Clock, color: "text-muted-foreground" },
  running: { label: "Running", icon: Loader2, color: "text-success" },
  completed: { label: "Completed", icon: CheckCircle2, color: "text-success" },
  failed: { label: "Failed", icon: XCircle, color: "text-destructive" },
};

// ---------------------------------------------------------------------------
// Schedule helpers
// ---------------------------------------------------------------------------

type Frequency = "daily" | "weekly" | "monthly" | "custom" | "manual";

const WEEKDAYS = [
  { key: "1", label: "Mon" },
  { key: "2", label: "Tue" },
  { key: "3", label: "Wed" },
  { key: "4", label: "Thu" },
  { key: "5", label: "Fri" },
  { key: "6", label: "Sat" },
  { key: "0", label: "Sun" },
] as const;

function buildCron(
  freq: Frequency,
  hour: number,
  minute: number,
  weekdays: string[],
  monthDay: number,
  customCron: string,
): string {
  switch (freq) {
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekly":
      return weekdays.length > 0
        ? `${minute} ${hour} * * ${weekdays.join(",")}`
        : `${minute} ${hour} * * *`;
    case "monthly":
      return `${minute} ${hour} ${monthDay} * *`;
    case "custom":
      return customCron;
    default:
      return "";
  }
}

function describeSchedule(
  freq: Frequency,
  hour: number,
  minute: number,
  weekdays: string[],
  monthDay: number,
  timezone: string,
): string {
  const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const tzShort = timezone.split("/").pop()?.replace(/_/g, " ") ?? timezone;
  switch (freq) {
    case "daily":
      return `Every day at ${timeStr} (${tzShort})`;
    case "weekly": {
      if (weekdays.length === 0) return `Every day at ${timeStr} (${tzShort})`;
      const dayNames = weekdays
        .map((d) => WEEKDAYS.find((w) => w.key === d)?.label)
        .filter(Boolean);
      return `Every ${dayNames.join(", ")} at ${timeStr} (${tzShort})`;
    }
    case "monthly":
      return `Monthly on day ${monthDay} at ${timeStr} (${tzShort})`;
    case "manual":
      return "Manual trigger only";
    case "custom":
      return "Custom cron schedule";
    default:
      return "";
  }
}

// Popular timezones grouped by region
const TIMEZONE_OPTIONS = [
  { group: "Americas", zones: ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Sao_Paulo"] },
  { group: "Europe", zones: ["Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Moscow"] },
  { group: "Asia", zones: ["Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul", "Asia/Singapore", "Asia/Kolkata", "Asia/Dubai"] },
  { group: "Pacific", zones: ["Pacific/Auckland", "Australia/Sydney"] },
  { group: "Other", zones: ["UTC"] },
];

function getLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

// ---------------------------------------------------------------------------
// Create Dialog
// ---------------------------------------------------------------------------

function CreateAgentflowDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const agents = useWorkspaceStore((s) => s.agents);
  const create = useAgentflowStore((s) => s.create);
  const setSelectedId = useAgentflowStore((s) => s.setSelectedId);

  // Basic info
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [agentId, setAgentId] = useState("");

  // Schedule
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [hour, setHour] = useState(10);
  const [minute, setMinute] = useState(0);
  const [weekdays, setWeekdays] = useState<string[]>(["1", "2", "3", "4", "5"]);
  const [monthDay, setMonthDay] = useState(1);
  const [customCron, setCustomCron] = useState("");
  const [timezone, setTimezone] = useState(getLocalTimezone);

  // Advanced
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [concurrencyPolicy, setConcurrencyPolicy] = useState("skip_if_active");

  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open && agents.length > 0 && !agentId && agents[0]) {
      setAgentId(agents[0].id);
    }
  }, [open, agents, agentId]);

  const selectedAgent = agents.find((a) => a.id === agentId);
  const isAgentOffline = selectedAgent?.status === "offline";

  const scheduleDescription = useMemo(
    () => describeSchedule(frequency, hour, minute, weekdays, monthDay, timezone),
    [frequency, hour, minute, weekdays, monthDay, timezone],
  );

  const cronExpression = useMemo(
    () => buildCron(frequency, hour, minute, weekdays, monthDay, customCron),
    [frequency, hour, minute, weekdays, monthDay, customCron],
  );

  const toggleWeekday = (day: string) => {
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  };

  const handleCreate = async () => {
    if (!title.trim() || !agentId) return;
    setCreating(true);
    try {
      const data: CreateAgentflowRequest = {
        title: title.trim(),
        description: description.trim(),
        agent_id: agentId,
        concurrency_policy: concurrencyPolicy,
        triggers:
          frequency !== "manual" && cronExpression
            ? [{ kind: "schedule", config: { cron: cronExpression, timezone }, enabled: true }]
            : [],
      };
      const af = await create(data);
      toast.success("Agentflow created");
      setSelectedId(af.id);
      onOpenChange(false);
      // Reset form
      setTitle("");
      setDescription("");
      setFrequency("daily");
      setHour(10);
      setMinute(0);
      setWeekdays(["1", "2", "3", "4", "5"]);
      setCustomCron("");
      setShowAdvanced(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create agentflow");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Agentflow</DialogTitle>
          <DialogDescription>
            Set up a scheduled or manual task for an agent.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-2">
          {/* Basic info */}
          <div className="space-y-2">
            <Label>Title</Label>
            <Input
              placeholder="e.g. Daily code review"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Prompt</Label>
            <textarea
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Describe what the agent should do..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            {!description.trim() && (
              <p className="text-xs text-muted-foreground">
                Agent will decide what to do based on the title.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Agent</Label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} {a.status === "offline" ? "(offline)" : ""}
                </option>
              ))}
            </select>
            {isAgentOffline && (
              <p className="flex items-center gap-1 text-xs text-warning">
                <AlertCircle className="h-3 w-3" />
                Agent is offline. The agentflow will run when the agent comes online.
              </p>
            )}
          </div>

          {/* Schedule */}
          <div className="space-y-3">
            <Label>Schedule</Label>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { value: "daily", label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                  { value: "monthly", label: "Monthly" },
                  { value: "custom", label: "Custom" },
                  { value: "manual", label: "Manual only" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFrequency(opt.value)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                    frequency === opt.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Frequency-specific controls */}
            {frequency !== "manual" && frequency !== "custom" && (
              <div className="space-y-3">
                {/* Weekly: day picker */}
                {frequency === "weekly" && (
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAYS.map((day) => (
                      <button
                        key={day.key}
                        onClick={() => toggleWeekday(day.key)}
                        className={`h-8 w-10 rounded-md border text-xs font-medium transition-colors ${
                          weekdays.includes(day.key)
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input text-muted-foreground hover:bg-accent"
                        }`}
                      >
                        {day.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Monthly: day of month */}
                {frequency === "monthly" && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">On day</span>
                    <select
                      className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm"
                      value={monthDay}
                      onChange={(e) => setMonthDay(Number(e.target.value))}
                    >
                      {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                    <span className="text-sm text-muted-foreground">of each month</span>
                  </div>
                )}

                {/* Time picker */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">at</span>
                  <select
                    className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm"
                    value={hour}
                    onChange={(e) => setHour(Number(e.target.value))}
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>
                        {String(i).padStart(2, "0")}
                      </option>
                    ))}
                  </select>
                  <span className="text-sm font-medium">:</span>
                  <select
                    className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm"
                    value={minute}
                    onChange={(e) => setMinute(Number(e.target.value))}
                  >
                    {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                      <option key={m} value={m}>
                        {String(m).padStart(2, "0")}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Timezone */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Timezone:</span>
                  <select
                    className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                  >
                    {TIMEZONE_OPTIONS.map((group) => (
                      <optgroup key={group.group} label={group.group}>
                        {group.zones.map((tz) => (
                          <option key={tz} value={tz}>
                            {tz.replace(/_/g, " ")}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Custom cron */}
            {frequency === "custom" && (
              <div className="space-y-2">
                <Input
                  placeholder="e.g. 0 10 * * 1-5"
                  value={customCron}
                  onChange={(e) => setCustomCron(e.target.value)}
                  className="font-mono text-sm"
                />
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Timezone:</span>
                  <select
                    className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                  >
                    {TIMEZONE_OPTIONS.map((group) => (
                      <optgroup key={group.group} label={group.group}>
                        {group.zones.map((tz) => (
                          <option key={tz} value={tz}>
                            {tz.replace(/_/g, " ")}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-muted-foreground">
                  Standard 5-field cron: minute hour day month weekday
                </p>
              </div>
            )}
          </div>

          {/* Schedule preview */}
          {frequency !== "manual" && (
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Zap className="h-3.5 w-3.5" />
                <span>{scheduleDescription}</span>
              </div>
              {frequency === "custom" && cronExpression && (
                <p className="mt-0.5 font-mono text-xs text-muted-foreground/70">
                  cron: {cronExpression}
                </p>
              )}
            </div>
          )}

          {/* Advanced options */}
          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronDown
                className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-0" : "-rotate-90"}`}
              />
              Advanced options
            </button>
            {showAdvanced && (
              <div className="mt-2 space-y-2 rounded-md border border-input p-3">
                <Label className="text-xs">Concurrency Policy</Label>
                <div className="flex flex-col gap-1.5">
                  {[
                    { value: "skip_if_active", label: "Skip if previous run is still active", desc: "Recommended" },
                    { value: "allow", label: "Allow parallel runs" },
                  ].map((opt) => (
                    <label key={opt.value} className="flex items-start gap-2 text-sm">
                      <input
                        type="radio"
                        name="concurrency"
                        value={opt.value}
                        checked={concurrencyPolicy === opt.value}
                        onChange={(e) => setConcurrencyPolicy(e.target.value)}
                        className="mt-0.5"
                      />
                      <span>
                        {opt.label}
                        {"desc" in opt && (
                          <span className="ml-1 text-xs text-muted-foreground">({opt.desc})</span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating || !title.trim() || !agentId}>
            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Detail Panel
// ---------------------------------------------------------------------------

function AgentflowDetail({ agentflow }: { agentflow: Agentflow }) {
  const agents = useWorkspaceStore((s) => s.agents);
  const { triggers, runs, runsLoading, fetchTriggers, fetchRuns, triggerRun, update, remove } =
    useAgentflowStore();
  const [tab, setTab] = useState<"runs" | "triggers" | "settings">("runs");

  const agent = agents.find((a) => a.id === agentflow.agent_id);

  useEffect(() => {
    fetchTriggers(agentflow.id);
    fetchRuns(agentflow.id);
  }, [agentflow.id, fetchTriggers, fetchRuns]);

  const handleToggleStatus = async () => {
    const newStatus = agentflow.status === "active" ? "paused" : "active";
    try {
      await update(agentflow.id, { status: newStatus });
      toast.success(newStatus === "active" ? "Agentflow activated" : "Agentflow paused");
    } catch {
      toast.error("Failed to update status");
    }
  };

  const handleRunNow = async () => {
    try {
      await triggerRun(agentflow.id);
      toast.success("Run triggered");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to trigger run");
    }
  };

  const handleDelete = async () => {
    try {
      await remove(agentflow.id);
      toast.success("Agentflow deleted");
    } catch {
      toast.error("Failed to delete agentflow");
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{agentflow.title}</h2>
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                  agentflow.status === "active"
                    ? "bg-success/10 text-success"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {agentflow.status === "active" ? "Active" : "Paused"}
              </span>
              {agent && <span>Agent: {agent.name}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleRunNow}>
              <Play className="mr-1.5 h-3.5 w-3.5" />
              Run Now
            </Button>
            <Button size="sm" variant="outline" onClick={handleToggleStatus}>
              {agentflow.status === "active" ? (
                <Pause className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Play className="mr-1.5 h-3.5 w-3.5" />
              )}
              {agentflow.status === "active" ? "Pause" : "Activate"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button size="sm" variant="ghost">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" onClick={handleDelete}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b px-6">
        <div className="flex gap-4">
          {(["runs", "triggers", "settings"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`border-b-2 px-1 py-2.5 text-sm font-medium capitalize transition-colors ${
                tab === t
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === "runs" && <RunsTab runs={runs} loading={runsLoading} />}
        {tab === "triggers" && <TriggersTab triggers={triggers} />}
        {tab === "settings" && <SettingsTab agentflow={agentflow} />}
      </div>
    </div>
  );
}

function RunsTab({ runs, loading }: { runs: AgentflowRun[]; loading: boolean }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [taskMessages, setTaskMessages] = useState<TaskMessagePayload[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const loadMessages = async (run: AgentflowRun) => {
    if (expandedId === run.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(run.id);
    if (run.task_id) {
      setMessagesLoading(true);
      try {
        const msgs = await api.listTaskMessages(run.task_id);
        setTaskMessages(msgs);
      } catch {
        setTaskMessages([]);
      } finally {
        setMessagesLoading(false);
      }
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        No runs yet. Click &quot;Run Now&quot; to trigger one.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {runs.map((run) => {
        const cfg = runStatusConfig[run.status] ?? runStatusConfig.pending!;
        const Icon = cfg!.icon;
        const color = cfg!.color;
        const label = cfg!.label;
        const isExpanded = expandedId === run.id;
        return (
          <div key={run.id} className="rounded-lg border">
            <button
              onClick={() => loadMessages(run)}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-accent/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Icon
                  className={`h-4 w-4 ${color} ${run.status === "running" ? "animate-spin" : ""}`}
                />
                <div>
                  <span className="text-sm font-medium">{label}</span>
                  <p className="text-xs text-muted-foreground">
                    {new Date(run.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {run.completed_at && (
                  <span className="text-xs text-muted-foreground">
                    {Math.round((new Date(run.completed_at).getTime() - new Date(run.created_at).getTime()) / 1000)}s
                  </span>
                )}
                <ChevronDown
                  className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
                />
              </div>
            </button>

            {isExpanded && (
              <div className="border-t px-4 py-3 space-y-3">
                {/* Output */}
                {run.output && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Output</p>
                    <div className="rounded-md bg-muted/50 p-3 text-sm whitespace-pre-wrap">
                      {run.output}
                    </div>
                  </div>
                )}

                {/* Error */}
                {run.error && (
                  <div>
                    <p className="text-xs font-medium text-destructive mb-1">Error</p>
                    <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive whitespace-pre-wrap">
                      {run.error}
                    </div>
                  </div>
                )}

                {/* Task messages (live log) */}
                {run.task_id && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">
                      Execution Log ({messagesLoading ? "loading..." : `${taskMessages.length} messages`})
                    </p>
                    {messagesLoading ? (
                      <Skeleton className="h-20 w-full" />
                    ) : taskMessages.length > 0 ? (
                      <div className="max-h-64 overflow-y-auto rounded-md border bg-muted/30 p-2 space-y-1">
                        {taskMessages.map((msg, i) => (
                          <div key={i} className="text-xs font-mono">
                            {msg.type === "tool_use" && msg.tool && (
                              <span className="text-primary">[{msg.tool}]</span>
                            )}
                            {msg.type === "text" && msg.content && (
                              <span className="text-foreground">{msg.content.slice(0, 200)}{msg.content.length > 200 ? "..." : ""}</span>
                            )}
                            {msg.type === "tool_result" && msg.output && (
                              <span className="text-muted-foreground">{msg.output.slice(0, 150)}{msg.output.length > 150 ? "..." : ""}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No messages recorded.</p>
                    )}
                  </div>
                )}

                {/* No output and no error */}
                {!run.output && !run.error && !run.task_id && run.status === "completed" && (
                  <p className="text-xs text-muted-foreground">Run completed with no output.</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TriggersTab({ triggers }: { triggers: AgentflowTrigger[] }) {
  if (triggers.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        No triggers configured. This agentflow can only be triggered manually.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {triggers.map((trigger) => {
        const config = trigger.config as { cron?: string; timezone?: string };
        return (
          <div
            key={trigger.id}
            className="flex items-center justify-between rounded-lg border px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <div>
                <span className="text-sm font-medium capitalize">{trigger.kind}</span>
                {config.cron && (
                  <p className="text-xs text-muted-foreground">
                    <code>{config.cron}</code>
                    {config.timezone && ` (${config.timezone})`}
                  </p>
                )}
              </div>
            </div>
            <span
              className={`text-xs ${trigger.enabled ? "text-success" : "text-muted-foreground"}`}
            >
              {trigger.enabled ? "Enabled" : "Disabled"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SettingsTab({ agentflow }: { agentflow: Agentflow }) {
  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs text-muted-foreground">Prompt</Label>
        <p className="mt-1 whitespace-pre-wrap text-sm">
          {agentflow.description || "(empty)"}
        </p>
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Concurrency Policy</Label>
        <p className="mt-1 text-sm">{agentflow.concurrency_policy}</p>
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Created</Label>
        <p className="mt-1 text-sm">{new Date(agentflow.created_at).toLocaleString()}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AgentflowsPage() {
  const { agentflows, loading, fetch, selectedId, setSelectedId } = useAgentflowStore();
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const selected = agentflows.find((af) => af.id === selectedId);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Agentflows</h1>
          <p className="text-sm text-muted-foreground">
            Scheduled and automated agent tasks
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          New Agentflow
        </Button>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* List */}
        <div className="w-80 flex-shrink-0 overflow-y-auto border-r">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : agentflows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground">
              <Zap className="mb-3 h-8 w-8 text-muted-foreground/40" />
              <p>No agentflows yet</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => setCreateOpen(true)}
              >
                Create one
              </Button>
            </div>
          ) : (
            <div className="py-1">
              {agentflows.map((af) => (
                <button
                  key={af.id}
                  onClick={() => setSelectedId(af.id)}
                  className={`w-full px-4 py-3 text-left transition-colors hover:bg-accent/50 ${
                    selectedId === af.id ? "bg-accent" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate text-sm font-medium">{af.title}</span>
                    <span
                      className={`ml-2 h-2 w-2 flex-shrink-0 rounded-full ${
                        af.status === "active" ? "bg-success" : "bg-muted-foreground/40"
                      }`}
                    />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {af.description || "No description"}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail */}
        <div className="flex-1 overflow-hidden">
          {selected ? (
            <AgentflowDetail agentflow={selected} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select an agentflow to view details
            </div>
          )}
        </div>
      </div>

      <CreateAgentflowDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
