import Link from "next/link";
import { ExamIllustration } from "@/frontend/marketing/exam-illustration";
import { ExamSysBrand } from "@/frontend/marketing/brand";

const benefits = [
  { mark: "✓", title: "Secure & reliable", description: "Your work stays protected" },
  { mark: "↗", title: "Easy access", description: "Start from any device" },
  { mark: "▥", title: "Track progress", description: "See where you are" },
  { mark: "★", title: "Focus on learning", description: "A calmer exam experience" },
];

const features = [
  {
    number: "01",
    title: "A clear start",
    description: "Instructions, timing, and exam details are easy to find before you begin.",
  },
  {
    number: "02",
    title: "Work with confidence",
    description: "Your progress is saved as you go, so you can focus on each question.",
  },
  {
    number: "03",
    title: "Know what comes next",
    description: "Candidates, examiners, and administrators get the tools for their role.",
  },
];

export function LandingPage() {
  return (
    <main className="marketing-page">
      <div className="marketing-shell">
        <header className="landing-header" id="home">
          <ExamSysBrand />
          <nav className="landing-nav" aria-label="Main navigation">
            <a className="landing-nav-active" href="#home">Home</a>
            <a href="#about">About</a>
            <a href="#features">Features</a>
            <a href="#how-it-works">How it works</a>
            <a href="#contact">Contact</a>
          </nav>
          <div className="landing-header-actions">
            <Link className="landing-signin" href="/login">Sign in</Link>
            <Link className="landing-signup" href="/login">
              Sign up <span aria-hidden="true">→</span>
            </Link>
          </div>
        </header>

        <section className="landing-hero" aria-labelledby="landing-heading">
          <div className="landing-hero-copy">
            <p className="landing-badge">
              <span className="landing-badge-icon" aria-hidden="true">★</span>
              Smarter exam management
              <span className="landing-badge-arrow" aria-hidden="true">›</span>
            </p>
            <p className="landing-eyebrow">A secure examination system</p>
            <h1 id="landing-heading">
              A calmer, fairer way <span>to take exams.</span>
            </h1>
            <p className="landing-lede">
              Organize, attempt, and manage exams with ease. A modern, reliable
              experience for students and educators.
            </p>
            <div className="landing-hero-actions">
              <Link className="landing-primary-action" href="/login">
                Get started <span aria-hidden="true">→</span>
              </Link>
              <a className="landing-secondary-action" href="#how-it-works">
                <span className="landing-play-mark" aria-hidden="true">▶</span>
                How it works
              </a>
            </div>
            <p className="landing-account-note">
              ExamSys accounts are provided by your institution.
            </p>
          </div>
          <ExamIllustration />
        </section>

        <section className="landing-benefits" id="about" aria-label="ExamSys benefits">
          {benefits.map((benefit) => (
            <div className="landing-benefit" key={benefit.title}>
              <span className="landing-benefit-icon" aria-hidden="true">{benefit.mark}</span>
              <span>
                <strong>{benefit.title}</strong>
                <small>{benefit.description}</small>
              </span>
            </div>
          ))}
        </section>

        <section className="landing-features" id="features">
          <div className="landing-section-heading">
            <p className="landing-eyebrow">Built around your exam day</p>
            <h2>Everything you need to do your best work.</h2>
            <p>Simple tools and thoughtful details make assessments easier to manage.</p>
          </div>
          <div className="landing-feature-grid">
            {features.map((feature) => (
              <article className="landing-feature-card" key={feature.number}>
                <span className="landing-feature-number">{feature.number}</span>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-how" id="how-it-works">
          <div>
            <p className="landing-eyebrow">How it works</p>
            <h2>Sign in. Get ready. Focus on the exam.</h2>
          </div>
          <p>
            Your institution provides your account and exam details. Sign in
            when you are ready and ExamSys will guide you through the rest.
          </p>
          <Link className="landing-how-link" href="/login">
            Go to sign in <span aria-hidden="true">→</span>
          </Link>
        </section>

        <footer className="landing-footer" id="contact">
          <ExamSysBrand />
          <p>Questions about access? Contact your institution&apos;s ExamSys administrator.</p>
          <span>ExamSys · Secure examinations</span>
        </footer>
      </div>
    </main>
  );
}
