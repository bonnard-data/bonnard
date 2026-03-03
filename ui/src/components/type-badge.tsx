const colors: Record<string, string> = {
  view: "bg-blue-50 text-blue-700 ring-blue-600/20",
  cube: "bg-purple-50 text-purple-700 ring-purple-600/20",
  number: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  string: "bg-amber-50 text-amber-700 ring-amber-600/20",
  time: "bg-sky-50 text-sky-700 ring-sky-600/20",
  boolean: "bg-rose-50 text-rose-700 ring-rose-600/20",
};

export function TypeBadge({ type }: { type: string }) {
  const color = colors[type.toLowerCase()] || "bg-gray-50 text-gray-700 ring-gray-600/20";
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${color}`}>
      {type}
    </span>
  );
}
