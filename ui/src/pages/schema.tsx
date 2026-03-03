import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type CubeMetaItem } from "../lib/api";
import { TypeBadge } from "../components/type-badge";

export function SchemaPage() {
  const [cubes, setCubes] = useState<CubeMetaItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .cubeMeta()
      .then((meta) => setCubes(meta.cubes || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-sm text-gray-500">Loading schema...</div>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
        <h2 className="text-sm font-semibold text-red-800">Failed to load schema</h2>
        <p className="mt-1 text-sm text-red-700">{error}</p>
      </div>
    );
  }

  const query = search.toLowerCase();
  const filtered = cubes.filter(
    (c) =>
      c.name.toLowerCase().includes(query) ||
      c.title.toLowerCase().includes(query) ||
      (c.description && c.description.toLowerCase().includes(query)),
  );

  const timeDimCount = (c: CubeMetaItem) =>
    c.dimensions.filter((d) => d.type === "time").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Schema</h1>
        <p className="mt-1 text-sm text-gray-500">
          {cubes.length} source{cubes.length !== 1 ? "s" : ""} available from Cube.
        </p>
      </div>

      <input
        type="text"
        placeholder="Filter by name or description..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
      />

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-500">
          {cubes.length === 0
            ? "No views available. Check that Cube is running and has models configured."
            : "No results matching your filter."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Type
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Measures
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Dimensions
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Time
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Segments
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {filtered.map((c) => (
                <tr key={c.name} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      to={`/schema/${encodeURIComponent(c.name)}`}
                      className="text-sm font-medium text-blue-600 hover:text-blue-800"
                    >
                      {c.name}
                    </Link>
                    {c.description && (
                      <p className="mt-0.5 text-xs text-gray-500 truncate max-w-xs">
                        {c.description}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <TypeBadge type={c.type} />
                  </td>
                  <td className="px-4 py-3 text-right text-sm tabular-nums text-gray-700">
                    {c.measures.length}
                  </td>
                  <td className="px-4 py-3 text-right text-sm tabular-nums text-gray-700">
                    {c.dimensions.length - timeDimCount(c)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm tabular-nums text-gray-700">
                    {timeDimCount(c)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm tabular-nums text-gray-700">
                    {c.segments.length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
