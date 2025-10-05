import type { ReactNode } from 'react';

interface PlaceholderViewProps {
  title: string;
  description: string;
  hint?: string;
  action?: ReactNode;
}

export function PlaceholderView({ title, description, hint, action }: PlaceholderViewProps) {
  return (
    <section className="placeholder-view panel-surface" role="status" aria-live="polite">
      <div className="placeholder-view__card">
        <h2>{title}</h2>
        <p>{description}</p>
        {hint && <p className="placeholder-view__hint">{hint}</p>}
        {action}
      </div>
    </section>
  );
}
