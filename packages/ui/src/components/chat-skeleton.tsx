"use client";

import { Skeleton } from "@multica/ui/components/ui/skeleton";

/** Skeleton placeholder matching MessageList layout, shown while reconnecting */
export function ChatSkeleton() {
  return (
    <div className="px-4 py-6 space-y-6 max-w-4xl mx-auto">
      {/* Assistant message */}
      <div className="flex justify-start">
        <div className="w-full p-1 px-2.5 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>

      {/* User message */}
      <div className="flex justify-end">
        <div className="bg-muted rounded-md max-w-[60%] p-1 px-2.5">
          <Skeleton className="h-4 w-32" />
        </div>
      </div>

      {/* Assistant message */}
      <div className="flex justify-start">
        <div className="w-full p-1 px-2.5 space-y-2">
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </div>

      {/* User message */}
      <div className="flex justify-end">
        <div className="bg-muted rounded-md max-w-[60%] p-1 px-2.5">
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
    </div>
  );
}
