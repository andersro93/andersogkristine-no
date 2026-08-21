import type { SVGProps } from "react";
import { ICONS, type IconDef, type IconName, SPINNER } from "./icons";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  /** Accessible name; omit for purely decorative icons */
  title?: string;
  strokeWidth?: number;
}

function a11y(title?: string) {
  return title
    ? ({ role: "img", "aria-label": title } as const)
    : ({ "aria-hidden": true } as const);
}

/** Inline SVG icon from the shared registry (React islands). */
export function Icon({
  name,
  title,
  strokeWidth,
  className,
  ...rest
}: IconProps) {
  const icon: IconDef = ICONS[name];
  const titleEl = title ? <title>{title}</title> : null;

  if (icon.fill) {
    return (
      // biome-ignore lint/a11y/noSvgWithoutTitle: <title>/aria-label are set when a name is given; otherwise the icon is decorative (aria-hidden)
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        {...a11y(title)}
        {...rest}
      >
        {titleEl}
        {icon.paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    );
  }
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: <title>/aria-label are set when a name is given; otherwise the icon is decorative (aria-hidden)
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth ?? icon.strokeWidth}
      className={className}
      {...a11y(title)}
      {...rest}
    >
      {titleEl}
      {icon.paths.map((d) => (
        <path key={d} strokeLinecap="round" strokeLinejoin="round" d={d} />
      ))}
    </svg>
  );
}

interface SpinnerProps extends SVGProps<SVGSVGElement> {
  title?: string;
}

/** Indeterminate spinner (React islands). */
export function Spinner({ title, className, ...rest }: SpinnerProps) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: <title>/aria-label are set when a name is given; otherwise the spinner is decorative (aria-hidden)
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      className={["animate-spin", className].filter(Boolean).join(" ")}
      {...a11y(title)}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <circle
        className="opacity-25"
        cx={SPINNER.circle.cx}
        cy={SPINNER.circle.cy}
        r={SPINNER.circle.r}
        stroke="currentColor"
        strokeWidth={SPINNER.circle.strokeWidth}
      />
      <path className="opacity-75" fill="currentColor" d={SPINNER.path} />
    </svg>
  );
}
