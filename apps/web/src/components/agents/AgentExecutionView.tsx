import type { AgentExecutionStep } from "../../api/types";
import { EmptyState } from "../ui/EmptyState";
import { AgentStepCard } from "./AgentStepCard";

export type AgentExecutionViewProps = {
  steps: AgentExecutionStep[];
  isRunning?: boolean;
};

export function AgentExecutionView({ steps, isRunning }: AgentExecutionViewProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-neutral-800">Выполнение</h3>
      {isRunning ? (
        <p className="text-sm text-neutral-600" role="status" aria-live="polite">
          Выполняется…
        </p>
      ) : null}
      {!isRunning && steps.length === 0 ? (
        <EmptyState title="Запустите агента" />
      ) : null}
      {steps.map((step) => (
        <AgentStepCard key={step.id} step={step} />
      ))}
    </div>
  );
}
