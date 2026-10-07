"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">화면을 표시하지 못했습니다.</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          잠시 문제가 생겼습니다. 다시 시도해도 기록이 지워지지는 않습니다.
        </p>
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-11 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          다시 시도
        </button>
      </div>
    </div>
  );
}
