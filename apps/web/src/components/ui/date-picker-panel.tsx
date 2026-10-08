"use client";

// Adapted from BoardUI's date-picker/shared and date-range-picker components.
// https://www.boardui.com/components/date-picker
import { useContext, useState } from "react";
import {
  Button as AriaButton, Calendar, RangeCalendar, CalendarCell, CalendarGrid,
  CalendarGridBody, CalendarGridHeader, CalendarHeaderCell,
  CalendarStateContext, RangeCalendarStateContext, type CalendarCellRenderProps,
} from "react-aria-components";
import {
  type CalendarDate, parseDate, getLocalTimeZone, today,
  startOfMonth, endOfMonth, startOfYear, endOfYear,
} from "@internationalized/date";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@agent-hub/ui";
import { parseDateChip, validDateDay, type PickerPreset } from "@/lib/date-picker";
import { cn } from "@/lib/utils";

function dateValue(value: string): CalendarDate | null {
  return validDateDay(value) ? parseDate(value) : null;
}
function chipValue(value: string) {
  return value ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : "";
}

function DateChip({ value, label, onCommit, onValidityChange }: {
  value: string; label: string; onCommit: (value: string) => void;
  onValidityChange: (invalid: boolean) => void;
}) {
  const [text, setText] = useState(chipValue(value));
  const invalid = text !== "" && !parseDateChip(text);
  const commit = () => {
    const parsed = parseDateChip(text);
    onValidityChange(!parsed);
    if (parsed) onCommit(parsed);
  };
  return <input type="text" inputMode="numeric" aria-label={label} aria-invalid={invalid || undefined}
    placeholder="DD/MM/YYYY" value={text} className="date-picker-chip"
    onChange={event => { setText(event.target.value); onValidityChange(!parseDateChip(event.target.value)); }}
    onBlur={commit} onKeyDown={event => {
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); commit(); }
      if (event.key === "Escape") { event.stopPropagation(); setText(chipValue(value)); onValidityChange(false); }
    }} />;
}

function DayCell({ date, formattedDate, isSelected, isSelectionStart, isSelectionEnd,
  isHovered, isFocusVisible, isDisabled, isOutsideMonth, isRange }: CalendarCellRenderProps & { isRange: boolean }) {
  if (isOutsideMonth) return <div className="date-picker-day" />;
  const weekday = date.toDate(getLocalTimeZone()).getDay();
  const single = isRange ? isSelectionStart && isSelectionEnd : isSelected;
  const edge = isRange ? isSelectionStart || isSelectionEnd : isSelected;
  return <div className="date-picker-day relative">
    <span aria-hidden className={cn("date-picker-band", isSelected && !single && "date-picker-band-selected")}
      style={{ left: isSelectionStart ? "50%" : isRange && isSelected && weekday !== 0 ? "-6px" : 0,
        right: isSelectionEnd ? "50%" : isRange && isSelected && weekday !== 6 ? "-6px" : 0 }} />
    <div className={cn("date-picker-day-face", isHovered && !isSelected && "date-picker-day-hover",
      isFocusVisible && "date-picker-day-focus", edge && "date-picker-day-edge", isDisabled && "opacity-40")}
      data-start={isSelectionStart || undefined} data-end={isSelectionEnd || undefined} data-single={single || undefined}>
      {formattedDate}
    </div>
  </div>;
}

function MonthPanel({ offset = 0, showPrev, showNext }: { offset?: number; showPrev?: boolean; showNext?: boolean }) {
  const rangeState = useContext(RangeCalendarStateContext);
  const singleState = useContext(CalendarStateContext);
  const state = rangeState ?? singleState;
  const date = state?.visibleRange.start.add({ months: offset });
  const title = date ? new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(date.toDate(getLocalTimeZone())) : "";
  return <div className="date-picker-month">
    <div className="mb-4 flex items-center justify-between gap-2">
      {showPrev ? <AriaButton slot="previous" aria-label="Previous month" className="date-picker-nav"><ChevronLeft className="size-4" /></AriaButton> : <span className="size-8" />}
      <span className="text-center text-sm font-medium">{title}</span>
      {showNext ? <AriaButton slot="next" aria-label="Next month" className="date-picker-nav"><ChevronRight className="size-4" /></AriaButton> : <span className="size-8" />}
    </div>
    <CalendarGrid offset={{ months: offset }} weekdayStyle="short" className="date-picker-grid">
      <CalendarGridHeader>{day => <CalendarHeaderCell className="pb-2 text-center text-xs font-normal text-muted-foreground">{day.slice(0, 2)}</CalendarHeaderCell>}</CalendarGridHeader>
      <CalendarGridBody>{date => <CalendarCell date={date} className="p-0 outline-none">{props => <DayCell {...props} isRange={rangeState !== null} />}</CalendarCell>}</CalendarGridBody>
    </CalendarGrid>
  </div>;
}

function defaultPresets(): PickerPreset[] {
  const now = today(getLocalTimeZone());
  const month = now.subtract({ months: 1 }), year = now.subtract({ years: 1 });
  const range = (from: CalendarDate, to: CalendarDate) => ({ from: from.toString(), to: to.toString() });
  return [
    { label: "Today", range: range(now, now) },
    { label: "Yesterday", range: range(now.subtract({ days: 1 }), now.subtract({ days: 1 })) },
    { label: "Last week", range: range(now.subtract({ days: 7 }), now.subtract({ days: 1 })) },
    { label: "This month", range: range(startOfMonth(now), endOfMonth(now)) },
    { label: "Last month", range: range(startOfMonth(month), endOfMonth(month)) },
    { label: "This year", range: range(startOfYear(now), endOfYear(now)) },
    { label: "Last year", range: range(startOfYear(year), endOfYear(year)) },
  ];
}

export default function DatePickerPanel({ mode, from, to, label, allowClear, presets,
  onCancel, onApply }: {
  mode: "single" | "range"; from: string; to: string; label: string;
  allowClear?: boolean; presets?: PickerPreset[];
  onCancel: () => void; onApply: (from: string, to: string) => void;
}) {
  const start = dateValue(from), end = dateValue(to);
  const [single, setSingle] = useState(start);
  const [range, setRange] = useState(start && end && start.compare(end) <= 0 ? { start, end } : null);
  const [focused, setFocused] = useState(start ?? end ?? today(getLocalTimeZone()));
  const [invalid, setInvalid] = useState({ from: false, to: false });
  const [cleared, setCleared] = useState(false);
  const [revision, setRevision] = useState(0);
  const a = mode === "range" ? range?.start.toString() ?? "" : single?.toString() ?? "";
  const b = range?.end.toString() ?? "";
  const invalidDates = invalid.from || invalid.to;
  const canApply = !invalidDates && (cleared || (mode === "single" ? single !== null : range !== null));
  function selectRange(next: { start: CalendarDate; end: CalendarDate }) {
    setRange(next); setCleared(false); setInvalid({ from: false, to: false });
    setRevision(old => old + 1);
  }
  const months = <div className="date-picker-months"><MonthPanel showPrev showNext={mode === "single"} />{mode === "range" && <MonthPanel offset={1} showNext />}</div>;
  return <div className="date-picker-panel" data-mode={mode}>
    <div className="date-picker-layout">
      {mode === "range" && <div className="date-picker-presets" aria-label="Quick date ranges">
        {(presets ?? defaultPresets()).map(preset => <button type="button" key={preset.label}
          aria-pressed={a === preset.range.from && b === preset.range.to}
          onClick={() => {
            const start = dateValue(preset.range.from), end = dateValue(preset.range.to);
            if (start && end && start.compare(end) <= 0) { selectRange({ start, end }); setFocused(start); }
          }} className="date-picker-preset">{preset.label}</button>)}
      </div>}
      {mode === "range" ? <RangeCalendar aria-label={label} autoFocus firstDayOfWeek="sun"
        visibleDuration={{ months: 2 }} pageBehavior="single" selectionAlignment="start"
        focusedValue={focused} onFocusChange={setFocused} value={range} onChange={selectRange}>{months}</RangeCalendar>
        : <Calendar aria-label={label} autoFocus firstDayOfWeek="sun" value={single}
          focusedValue={focused} onFocusChange={setFocused} onChange={value => {
            setSingle(value); setCleared(false); setInvalid({ from: false, to: false });
            setRevision(old => old + 1);
          }}>{months}</Calendar>}
    </div>
    <div className="date-picker-footer">
      <div className="flex flex-wrap items-center gap-2">
        <DateChip key={`from-${a}-${revision}`} value={a} label={mode === "range" ? "Start date" : "Selected date"}
          onValidityChange={from => setInvalid(old => ({ ...old, from }))}
          onCommit={value => {
            const date = parseDate(value); setFocused(date); setCleared(false);
            if (mode === "single") setSingle(date);
            else setRange({ start: date, end: range && date.compare(range.end) <= 0 ? range.end : date });
          }} />
        {mode === "range" && <><span aria-hidden className="text-muted-foreground">–</span>
          <DateChip key={`to-${b}-${revision}`} value={b} label="End date"
            onValidityChange={to => setInvalid(old => ({ ...old, to }))}
            onCommit={value => {
              const date = parseDate(value); setFocused(date);
              setCleared(false);
              setRange({ start: range && date.compare(range.start) >= 0 ? range.start : date, end: date });
            }} /></>}
        {allowClear && <Button variant="ghost" size="sm" onClick={() => {
          setSingle(null); setRange(null); setCleared(true); setInvalid({ from: false, to: false });
          setRevision(old => old + 1);
        }}>Clear</Button>}
      </div>
      {invalidDates && <p role="alert" className="w-full text-xs text-destructive">Enter a valid date as DD/MM/YYYY.</p>}
      <div className="ml-auto flex gap-2"><Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" disabled={!canApply} onClick={() => onApply(a, mode === "range" ? b : "")}>Apply</Button></div>
    </div>
  </div>;
}
