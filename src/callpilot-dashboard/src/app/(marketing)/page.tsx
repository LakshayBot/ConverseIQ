import Link from "next/link";
import { TextAnimate } from "@/components/magicui/text-animate";
import { BorderBeam } from "@/components/magicui/border-beam";
import { LiveCallDemo } from "@/components/marketing/LiveCallDemo";

const GITHUB_URL = "https://github.com/LakshayBot/ConverseIQ";

export default function LandingPage() {
  return (
    <>
      {/* Nav */}
      <header className="landing-nav">
        <Link href="/" className="wordmark">
          CallPilot
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="btn-ghost"
            style={{ minHeight: 40, padding: "0.5rem 1.25rem" }}
          >
            Sign in
          </Link>
          <Link
            href="/login"
            className="btn-primary"
            style={{ minHeight: 40, padding: "0.5rem 1.25rem" }}
          >
            <span className="hidden sm:inline">Open dashboard</span>
            <span className="sm:hidden">Open</span>
          </Link>
        </div>
      </header>

      {/* Hero — the live-call demo is the signature moment */}
      <section className="hero">
        <div>
          <p className="eyebrow">Real-time sales intelligence</p>
          <h1 className="display">
            <TextAnimate animation="blurInUp" by="word" as="span">
              Intelligence, live, in the meeting.
            </TextAnimate>
          </h1>
          <p className="lede">
            CallPilot transcribes your sales calls as they happen, spots
            competitors, objections, pricing and product mentions the moment
            they’re spoken — and grounds the rep’s next move in your own
            knowledge base.
          </p>
          <div className="hero-ctas">
            <Link href="/login" className="btn-primary">
              Open the dashboard
              <BorderBeam size={120} borderWidth={1.5} colorFrom="#e58a7b" colorTo="#93483c" />
            </Link>
            <Link href={GITHUB_URL} className="btn-ghost">
              Source on GitHub
            </Link>
          </div>
        </div>

        <div className="demo-wrap">
          <LiveCallDemo />
          <p className="demo-caption">A live call, as CallPilot reads it</p>
        </div>
      </section>
    </>
  );
}
