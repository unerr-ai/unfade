import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { StepIntegrations } from "./StepIntegrations";
import { StepIntelligence } from "./StepIntelligence";
import { StepLaunch } from "./StepLaunch";
import { StepProjects } from "./StepProjects";

const STEPS = [
  { id: "intelligence", label: "Intelligence" },
  { id: "projects", label: "Projects" },
  { id: "integrations", label: "Integrations" },
  { id: "launch", label: "Launch" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

export default function SetupWizard() {
  const [currentStep, setCurrentStep] = useState<StepId>("intelligence");
  const [completed, setCompleted] = useState<Set<StepId>>(new Set());

  const currentIndex = STEPS.findIndex((s) => s.id === currentStep);

  const goBack = () => {
    const prev = STEPS[currentIndex - 1];
    if (prev) setCurrentStep(prev.id);
  };

  const advance = () => {
    setCompleted((prev) => new Set(prev).add(currentStep));
    const next = STEPS[currentIndex + 1];
    if (next) setCurrentStep(next.id);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-2xl">
        {/* Brand header */}
        <div className="mb-10 text-center">
          <img
            src="/public/icon.svg"
            alt="Unfade"
            width={48}
            height={48}
            className="mx-auto mb-4"
          />
          <h1 className="text-2xl font-heading font-bold bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] bg-clip-text text-transparent">
            unfade
          </h1>
          <p className="mt-1.5 text-sm text-muted">Set up your reasoning capture layer</p>
        </div>

        {/* Stepper */}
        <div className="mb-8 flex items-center justify-center">
          {STEPS.map((step, i) => {
            const isComplete = completed.has(step.id);
            const isCurrent = step.id === currentStep;
            const isPast = i < currentIndex;
            return (
              <div key={step.id} className="flex items-center">
                <button
                  type="button"
                  onClick={() => (isComplete || isPast ? setCurrentStep(step.id) : undefined)}
                  className={cn(
                    "flex items-center gap-2 transition-colors",
                    isComplete || isPast ? "cursor-pointer" : "cursor-default",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-all",
                      isComplete
                        ? "bg-[#8B5CF6] text-white"
                        : isCurrent
                          ? "bg-[#8B5CF6] text-white ring-4 ring-[#8B5CF6]/20"
                          : "bg-raised text-muted",
                    )}
                  >
                    {isComplete ? <Check size={14} /> : i + 1}
                  </div>
                  <span
                    className={cn(
                      "text-sm",
                      isCurrent
                        ? "text-foreground font-medium"
                        : isComplete
                          ? "text-foreground/70"
                          : "text-muted",
                    )}
                  >
                    {step.label}
                  </span>
                </button>
                {i < STEPS.length - 1 && (
                  <div
                    className={cn("mx-4 h-px w-12", isComplete ? "bg-[#8B5CF6]/50" : "bg-border")}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Step content card */}
        <div className="rounded-xl border border-border bg-surface p-6 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
            >
              {currentStep === "intelligence" && <StepIntelligence onComplete={advance} />}
              {currentStep === "projects" && <StepProjects onComplete={advance} onBack={goBack} />}
              {currentStep === "integrations" && (
                <StepIntegrations onComplete={advance} onBack={goBack} />
              )}
              {currentStep === "launch" && <StepLaunch onBack={goBack} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
