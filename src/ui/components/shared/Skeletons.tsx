import { cn } from "@/lib/utils";

function Pulse({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-raised", className)} />;
}

export function HomeSkeleton() {
  return (
    <div className="space-y-6">
      <Pulse className="h-16" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Pulse key={i} className="h-28" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Pulse key={i} className="h-24" />
        ))}
      </div>
      <Pulse className="h-48" />
    </div>
  );
}

export function IntelligenceSkeleton() {
  return (
    <div className="space-y-6">
      <Pulse className="h-8 w-48" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <Pulse key={i} className="h-28" />
        ))}
      </div>
    </div>
  );
}

export function DecisionsSkeleton() {
  return (
    <div className="space-y-6">
      <Pulse className="h-8 w-48" />
      <div className="flex gap-3">
        <Pulse className="h-10 flex-1" />
        <Pulse className="h-10 w-32" />
        <Pulse className="h-10 w-24" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Pulse key={i} className="h-12" />
        ))}
      </div>
    </div>
  );
}

export function LiveSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Pulse className="h-8 w-24" />
        <Pulse className="h-4 w-32" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Pulse key={i} className="h-9 w-16" />
        ))}
      </div>
      <div className="space-y-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <Pulse key={i} className="h-14" />
        ))}
      </div>
    </div>
  );
}

export function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <Pulse className="h-8 w-36" />
      <Pulse className="h-32" />
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Pulse key={i} className="h-24" />
        ))}
      </div>
      <Pulse className="h-64" />
    </div>
  );
}

export function GenericSkeleton() {
  return (
    <div className="space-y-4">
      <Pulse className="h-8 w-48" />
      <Pulse className="h-64" />
    </div>
  );
}
