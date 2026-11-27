import Link from "next/link";

type Props = {
  className?: string;
};

export function ExamSysBrand({ className = "" }: Readonly<Props>) {
  return (
    <Link className={`exam-brand ${className}`.trim()} href="/" aria-label="ExamSys home">
      <span className="exam-brand-mark" aria-hidden="true">
        <svg viewBox="0 0 40 40" fill="none">
          <path d="m3 14 17-9 17 9-17 9L3 14Z" fill="currentColor" />
          <path d="m10 18 10 5 10-5v8c-5.8 5-14.2 5-20 0v-8Z" fill="currentColor" opacity=".8" />
          <path d="M36 15v11" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
          <circle cx="36" cy="29" r="2" fill="currentColor" />
        </svg>
      </span>
      <span className="exam-brand-name">Exam<span>Sys</span></span>
    </Link>
  );
}
