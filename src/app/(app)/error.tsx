"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card mx-auto max-w-lg p-8 text-center">
      <h2 className="text-xl font-bold">Something went wrong loading this page</h2>
      <p className="mt-2 text-sm text-slate-500">Your data is safe. Nothing was changed. Please try again.</p>
      <button className="btn-primary mt-5" onClick={reset}>Try again</button>
    </div>
  );
}
