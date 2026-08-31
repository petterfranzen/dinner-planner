import { useEffect, useState } from "react";
import { api } from "../api/client";
import { addDays, formatDayLabel } from "../dateUtils";
import { DAY_NAMES, MEAL_TYPES, type MealPlanEntry, type MealType, type Recipe } from "../types";

interface Props {
  weekStart: string;
  recipes: Recipe[];
}

export function WeekPlanner({ weekStart, recipes }: Props) {
  const [entries, setEntries] = useState<MealPlanEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .getMealPlan(weekStart)
      .then((res) => setEntries(res.entries))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [weekStart]);

  function entryFor(day: number, mealType: MealType) {
    return entries.find((e) => e.day_of_week === day && e.meal_type === mealType);
  }

  async function setRecipe(day: number, mealType: MealType, recipeId: number | null) {
    const updated = await api.setMealPlanSlot(weekStart, day, mealType, {
      recipeId,
      servingsOverride: null,
      note: null,
    });
    setEntries((prev) => {
      const rest = prev.filter((e) => !(e.day_of_week === day && e.meal_type === mealType));
      return [...rest, updated];
    });
  }

  async function setNote(day: number, mealType: MealType, note: string) {
    const updated = await api.setMealPlanSlot(weekStart, day, mealType, {
      recipeId: null,
      servingsOverride: null,
      note: note || null,
    });
    setEntries((prev) => {
      const rest = prev.filter((e) => !(e.day_of_week === day && e.meal_type === mealType));
      return [...rest, updated];
    });
  }

  if (loading) return <p>Loading plan…</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div className="week-grid">
      <div className="week-grid-header week-grid-corner" />
      {DAY_NAMES.map((name, i) => (
        <div className="week-grid-header" key={name}>
          <div>{name}</div>
          <div className="week-grid-date">{formatDayLabel(addDays(weekStart, i))}</div>
        </div>
      ))}

      {MEAL_TYPES.map((mealType) => (
        <FragmentRow
          key={mealType}
          mealType={mealType}
          entryFor={entryFor}
          recipes={recipes}
          onSetRecipe={setRecipe}
          onSetNote={setNote}
        />
      ))}
    </div>
  );
}

function FragmentRow({
  mealType,
  entryFor,
  recipes,
  onSetRecipe,
  onSetNote,
}: {
  mealType: MealType;
  entryFor: (day: number, mealType: MealType) => MealPlanEntry | undefined;
  recipes: Recipe[];
  onSetRecipe: (day: number, mealType: MealType, recipeId: number | null) => void;
  onSetNote: (day: number, mealType: MealType, note: string) => void;
}) {
  return (
    <>
      <div className="week-grid-header meal-type-label">{mealType}</div>
      {Array.from({ length: 7 }, (_, day) => {
        const entry = entryFor(day, mealType);
        return (
          <div className="week-cell" key={day}>
            <select
              value={entry?.recipe_id ?? ""}
              onChange={(e) => onSetRecipe(day, mealType, e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— none —</option>
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
            <input
              className="week-cell-note"
              placeholder="note (e.g. leftovers)"
              defaultValue={entry?.note ?? ""}
              onBlur={(e) => onSetNote(day, mealType, e.target.value)}
            />
          </div>
        );
      })}
    </>
  );
}
