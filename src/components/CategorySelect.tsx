export interface CatOpt { id: string; name: string; parentId: string | null; kind: string }

export function CategoryOptions({ categories, includeMovement = true }: { categories: CatOpt[]; includeMovement?: boolean }) {
  const parents = categories.filter((c) => !c.parentId && (includeMovement || c.kind !== "NON_OPERATING")).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      {parents.map((p) => (
        <optgroup key={p.id} label={p.name}>
          <option value={p.id}>{p.name} (general)</option>
          {categories.filter((c) => c.parentId === p.id).sort((a, b) => a.name.localeCompare(b.name)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      ))}
    </>
  );
}
