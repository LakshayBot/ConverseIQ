"use client";
import React, { useRef } from "react";
import { useScroll, useTransform, motion, MotionValue } from "motion/react";

// CallPilot adaptation of Aceternity's ContainerScroll:
//   - 3D rotate-in-on-scroll reveal (rotateX 20deg → 0)
//   - light frame (opaline hairline border + whisper shadow) instead of
//     the library's dark #222222 slab
//   - reduced pin height so it doesn't dominate the page
export const ContainerScroll = ({
  titleComponent,
  children,
}: {
  titleComponent: string | React.ReactNode;
  children: React.ReactNode;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
  });
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => {
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  const scaleDimensions = () => {
    return isMobile ? [0.85, 0.95] : [1.05, 1];
  };

  const rotate = useTransform(scrollYProgress, [0, 1], [20, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], scaleDimensions());
  const translate = useTransform(scrollYProgress, [0, 1], [0, -80]);

  return (
    <div
      className="relative flex h-[46rem] items-center justify-center p-2 md:h-[56rem] md:p-20"
      ref={containerRef}
    >
      <div
        className="relative w-full py-10 md:py-40"
        style={{ perspective: "1000px" }}
      >
        <Header translate={translate} titleComponent={titleComponent} />
        <Card rotate={rotate} translate={translate} scale={scale}>
          {children}
        </Card>
      </div>
    </div>
  );
};

export const Header = ({ translate, titleComponent }: any) => {
  return (
    <motion.div
      style={{ translateY: translate }}
      className="mx-auto max-w-5xl text-center"
    >
      {titleComponent}
    </motion.div>
  );
};

export const Card = ({
  rotate,
  scale,
  children,
}: {
  rotate: MotionValue<number>;
  scale: MotionValue<number>;
  translate: MotionValue<number>;
  children: React.ReactNode;
}) => {
  return (
    <motion.div
      style={{
        rotateX: rotate,
        scale,
        boxShadow:
          "0 1px 2px oklch(20% 0.01 55 / 0.05), 0 12px 24px oklch(20% 0.01 55 / 0.06), 0 40px 60px oklch(20% 0.01 55 / 0.05)",
      }}
      className="mx-auto h-[26rem] w-full max-w-5xl rounded-2xl border border-[var(--opaline-outline-variant)] bg-[var(--opaline-surface-container-lowest)] p-2 md:h-[34rem] md:p-4"
    >
      <div className="h-full w-full overflow-hidden rounded-xl bg-[var(--opaline-surface-container-low)]">
        {children}
      </div>
    </motion.div>
  );
};
