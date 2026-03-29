import type { AgentExecutionStep } from "../../api/types";
import { Card, CardContent, CardHeader } from "../ui/Card";

export type AgentStepCardProps = {
  step: AgentExecutionStep;
};

function formatValue(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

const typeLabel: Record<AgentExecutionStep["type"], string> = {
  thinking: "thinking",
  tool: "tool",
  response: "response",
};

export function AgentStepCard({ step }: AgentStepCardProps) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded bg-neutral-100 px-2 py-0.5 font-mono text-xs font-medium text-neutral-800">
            {typeLabel[step.type]}
          </span>
          {step.toolName ? (
            <span className="font-mono text-xs text-neutral-500">
              {step.toolName}
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-neutral-700">
        {step.content ? (
          <p className="whitespace-pre-wrap break-words">{step.content}</p>
        ) : null}
        {step.input !== undefined && step.input !== null && step.input !== "" ? (
          <div>
            <p className="text-xs font-medium text-neutral-500">input</p>
            <pre className="mt-1 max-h-40 overflow-auto rounded border border-neutral-100 bg-neutral-50 p-2 font-mono text-xs whitespace-pre-wrap break-words">
              {formatValue(step.input)}
            </pre>
          </div>
        ) : null}
        {step.output !== undefined && step.output !== null && step.output !== "" ? (
          <div>
            <p className="text-xs font-medium text-neutral-500">output</p>
            <pre className="mt-1 max-h-48 overflow-auto rounded border border-neutral-100 bg-neutral-50 p-2 font-mono text-xs whitespace-pre-wrap break-words">
              {formatValue(step.output)}
            </pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
