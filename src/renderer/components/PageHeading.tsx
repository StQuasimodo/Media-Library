import type { ReactNode } from 'react';

/** A consistent editorial opening for the collection and utility pages. */
export function PageHeading({ title, eyebrow, description, children }: {
  title: string;
  eyebrow: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="gallery-heading">
      <div className="gallery-heading-copy">
        <p className="gallery-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="gallery-description">{description}</p>
      </div>
      {children ? <div className="gallery-heading-actions">{children}</div> : null}
    </header>
  );
}
