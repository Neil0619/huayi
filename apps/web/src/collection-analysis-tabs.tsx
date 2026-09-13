import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import type { AnalysisRecordRead } from "@huayi/cloud-contracts";
import { DeepAnalysisReading } from "./deep-analysis-reading.js";
import { NativeSentenceReading } from "./native-sentence-reading.js";
import { useAnalysisTabsPosition } from "./use-analysis-tabs-position.js";
import "./collection-analysis-tabs.css";

const sections = [
  { id: "overview", label: "译文" },
  { id: "details", label: "深度解析" },
  { id: "learning", label: "学习内容" },
] as const;
type Section = (typeof sections)[number]["id"];

export function CollectionAnalysisTabs({
  analysis,
  units,
  children,
}: {
  analysis: AnalysisRecordRead | undefined;
  units: ComponentProps<typeof NativeSentenceReading>["units"];
  children: ReactNode;
}) {
  const id = useId();
  // A streamed reading stays in this same panel when the final analysis arrives.
  const [selection, setActive] = useState<Section | null>(null);
  const active = selection ?? (analysis ? "overview" : "details");
  useEffect(() => {
    if (!analysis && units.length > 0) setActive("details");
  }, [analysis, units.length]);
  const container = useRef<HTMLDivElement>(null);
  const buttons = useRef<Partial<Record<Section, HTMLButtonElement | null>>>({});
  const hasContent = Boolean(analysis || units.length);
  useAnalysisTabsPosition(container, hasContent);
  if (!hasContent) return null;
  const available = sections.filter((section) => analysis || section.id === "details");
  const select = (section: Section) => {
    const scrolledPastStart = (container.current?.getBoundingClientRect().top ?? 0) < 0;
    setActive(section);
    if (scrolledPastStart)
      requestAnimationFrame(() => container.current?.scrollIntoView({ block: "start" }));
  };
  return (
    <div className="collection-analysis-tabs" ref={container}>
      <div className="collection-analysis-tablist" role="tablist" aria-label="分析内容">
        {sections.map((section) => (
          <button
            key={section.id}
            ref={(node) => {
              buttons.current[section.id] = node;
            }}
            type="button"
            role="tab"
            id={`${id}-${section.id}-tab`}
            aria-label={section.label}
            aria-controls={`${id}-${section.id}-panel`}
            aria-selected={active === section.id}
            disabled={!analysis && section.id !== "details"}
            tabIndex={active === section.id ? 0 : -1}
            onClick={() => select(section.id)}
            onKeyDown={(event) => {
              const current = available.findIndex((item) => item.id === section.id);
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? available.length - 1
                    : event.key === "ArrowRight"
                      ? (current + 1) % available.length
                      : event.key === "ArrowLeft"
                        ? (current + available.length - 1) % available.length
                        : undefined;
              if (next === undefined) return;
              event.preventDefault();
              const target = available[next];
              if (target) {
                select(target.id);
                buttons.current[target.id]?.focus();
              }
            }}
          >
            {section.label}
            {section.id === "learning" && analysis && (
              <span className="analysis-tab-count" aria-hidden="true">
                {analysis.candidates.length}
              </span>
            )}
          </button>
        ))}
      </div>
      {sections.map((section) => (
        <div
          className="collection-analysis-panel"
          key={section.id}
          role="tabpanel"
          id={`${id}-${section.id}-panel`}
          aria-labelledby={`${id}-${section.id}-tab`}
          hidden={active !== section.id}
          tabIndex={0}
        >
          {section.id === "overview" && analysis && (
            <DeepAnalysisReading analysis={analysis} section="overview" />
          )}
          {section.id === "details" &&
            (units.length > 0 ? (
              <NativeSentenceReading units={units} />
            ) : (
              analysis && <DeepAnalysisReading analysis={analysis} section="details" />
            ))}
          {section.id === "learning" && children}
        </div>
      ))}
    </div>
  );
}
