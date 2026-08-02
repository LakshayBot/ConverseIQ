import Link from "next/link";
import { TextAnimate } from "@/components/magicui/text-animate";
import { BorderBeam } from "@/components/magicui/border-beam";
import { LiveCallDemo } from "@/components/marketing/LiveCallDemo";
import { SiteNav } from "@/components/marketing/SiteNav";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { FeatureGrid } from "@/components/marketing/FeatureGrid";
import { ProductShots } from "@/components/marketing/ProductShots";
import { Privacy } from "@/components/marketing/Privacy";
import { CompareTable } from "@/components/marketing/CompareTable";
import { OpenSource } from "@/components/marketing/OpenSource";
import { FAQSection } from "@/components/marketing/FAQSection";
import { FinalCTA } from "@/components/marketing/FinalCTA";
import { Footer } from "@/components/marketing/Footer";

const GITHUB_URL = "https://github.com/LakshayBot/ConverseIQ";

export default function LandingPage() {
  return (
    <>
      {/* Scroll-aware nav (fixed; hero's top padding clears it) */}
      <SiteNav />

      <span id="top" aria-hidden />

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

      <HowItWorks />
      <FeatureGrid />
      <ProductShots />
      <Privacy />
      <CompareTable />
      <OpenSource />
      <FAQSection />
      <FinalCTA />
      <Footer />
    </>
  );
}
