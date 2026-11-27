type Props = {
  variant?: "hero" | "auth";
};

export function ExamIllustration({ variant = "hero" }: Readonly<Props>) {
  return (
    <div className={`exam-illustration exam-illustration--${variant}`} aria-hidden="true">
      <div className="illustration-halo" />
      <div className="illustration-orbit illustration-orbit--one" />
      <div className="illustration-orbit illustration-orbit--two" />

      <div className="illustration-float illustration-float--book">
        <svg viewBox="0 0 64 54" fill="none">
          <path d="M5 11c10-4 19-2 27 5v31C23 40 14 38 5 42V11Z" fill="#fff" stroke="#1b8c76" strokeWidth="3" strokeLinejoin="round" />
          <path d="M59 11c-10-4-19-2-27 5v31c9-7 18-9 27-5V11Z" fill="#d9f4ed" stroke="#1b8c76" strokeWidth="3" strokeLinejoin="round" />
          <path d="M12 19c5-1 10 0 14 3M12 26c5-1 10 0 14 3M52 19c-5-1-10 0-14 3M52 26c-5-1-10 0-14 3" stroke="#7abdaf" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>

      <div className="illustration-float illustration-float--spark">
        <svg viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="4" fill="#f3a72d" />
          <ellipse cx="24" cy="24" rx="19" ry="8" stroke="#168b75" strokeWidth="2" />
          <ellipse cx="24" cy="24" rx="19" ry="8" stroke="#168b75" strokeWidth="2" transform="rotate(60 24 24)" />
          <ellipse cx="24" cy="24" rx="19" ry="8" stroke="#168b75" strokeWidth="2" transform="rotate(120 24 24)" />
        </svg>
      </div>

      <div className="illustration-clock">
        <span className="clock-hand clock-hand--hour" />
        <span className="clock-hand clock-hand--minute" />
        <span className="clock-center" />
      </div>

      <div className="illustration-books">
        <span />
        <span />
        <span />
      </div>

      <div className="illustration-paper">
        <div className="illustration-cap">
          <svg viewBox="0 0 120 64" fill="none">
            <path d="m7 25 53-19 53 19-53 20L7 25Z" fill="#163a3b" />
            <path d="M27 34v13c17 13 39 13 56 0V34L60 46 27 34Z" fill="#244f50" />
            <path d="M112 26v20" stroke="#eda933" strokeWidth="3" strokeLinecap="round" />
            <circle cx="112" cy="50" r="4" fill="#eda933" />
          </svg>
        </div>
        <div className="illustration-paper-heading">
          <span>EXAM</span>
          <span className="paper-status">READY</span>
        </div>
        <div className="illustration-question">
          <span>✓</span>
          <i />
        </div>
        <div className="illustration-question">
          <span>✓</span>
          <i />
        </div>
        <div className="illustration-question">
          <span>✓</span>
          <i />
        </div>
        <div className="illustration-question">
          <span>✓</span>
          <i />
        </div>
      </div>

      <div className="illustration-dot illustration-dot--one" />
      <div className="illustration-dot illustration-dot--two" />
    </div>
  );
}
