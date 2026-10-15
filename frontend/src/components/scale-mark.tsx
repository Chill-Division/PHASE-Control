import { ChartPie, Gauge } from "lucide-react";
import { SCALE_WORDS, scaleTitle, settingWords, type SettingScale } from "@/lib/setting-words";
import "./scale-mark.css";

const ICONS = { absolute: Gauge, relative: ChartPie } as const;

/** Beside a percentage setting: a moisture reading (absolute), or a share of something else
 * (relative). A shape and words on hover and to a screen reader, not only a colour. */
export function ScaleMark({ scale, of }: { scale: SettingScale; of?: string }) {
  const Icon = ICONS[scale];
  const title = scaleTitle(scale, of);
  return (
    <span className="scale-mark" data-scale={scale} role="img" aria-label={title} title={title}>
      <Icon aria-hidden="true" />
    </span>
  );
}

/** The mark for a setting by its key, or nothing when it is not a percentage. */
export function ScaleMarkFor({ param }: { param: string }) {
  const words = settingWords(param);
  return words?.scale ? <ScaleMark scale={words.scale} of={words.scaleOf} /> : null;
}

/** What the two marks mean, at the top of a page of settings. */
export function ScaleLegend() {
  return (
    <div className="scale-legend" role="note" aria-label="Absolute and relative percentages">
      {(["absolute", "relative"] as const).map((scale) => {
        const Icon = ICONS[scale];
        return (
          <p key={scale}>
            <span className="scale-mark" data-scale={scale} aria-hidden="true">
              <Icon />
            </span>
            <span>
              <strong>{SCALE_WORDS[scale].name}:</strong> {SCALE_WORDS[scale].legend}
            </span>
          </p>
        );
      })}
    </div>
  );
}
