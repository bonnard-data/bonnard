import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, type CubeMetaItem } from "../lib/api";
import { TypeBadge } from "../components/type-badge";

export function SchemaDetailPage() {
  const { name } = useParams<{ name: string }>();
  const [cube, setCube] = useState<CubeMetaItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!name) return;
    api
      .cubeMeta()
      .then((meta) => {
        const found = (meta.cubes || []).find((c) => c.name === name);
        if (!found) {
          setError(`Source "${name}" not found`);
        } else {
          setCube(found);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [name]);

  if (loading) {
    return <div className="text-sm text-gray-500">Loading...</div>;
  }

  if (error || !cube) {
    return (
      <div className="space-y-4">
        <Link to="/schema" className="text-sm text-blue-600 hover:text-blue-800">
          &larr; Back to schema
        </Link>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6">
          <p className="text-sm text-red-700">{error || "Not found"}</p>
        </div>
      </div>
    );
  }

  const dimensions = cube.dimensions.filter((d) => d.type !== "time");
  const timeDimensions = cube.dimensions.filter((d) => d.type === "time");

  return (
    <div className="space-y-8">
      <div>
        <Link to="/schema" className="text-sm text-blue-600 hover:text-blue-800">
          &larr; Back to schema
        </Link>
        <div className="mt-3 flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">{cube.name}</h1>
          <TypeBadge type={cube.type} />
        </div>
        {cube.description && (
          <p className="mt-2 text-sm text-gray-600">{cube.description}</p>
        )}
      </div>

      {cube.measures.length > 0 && (
        <section>
          <h2 className="text-lg font-medium text-gray-900 mb-3">
            Measures ({cube.measures.length})
          </h2>
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
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {cube.measures.map((m) => (
                  <tr key={m.name}>
                    <td className="px-4 py-3 text-sm font-mono text-gray-900">{m.name}</td>
                    <td className="px-4 py-3">
                      <TypeBadge type={m.aggType || m.type} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {m.description || <span className="text-gray-400">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {dimensions.length > 0 && (
        <section>
          <h2 className="text-lg font-medium text-gray-900 mb-3">
            Dimensions ({dimensions.length})
          </h2>
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
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {dimensions.map((d) => (
                  <tr key={d.name}>
                    <td className="px-4 py-3 text-sm font-mono text-gray-900">{d.name}</td>
                    <td className="px-4 py-3">
                      <TypeBadge type={d.type} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {d.description || <span className="text-gray-400">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {timeDimensions.length > 0 && (
        <section>
          <h2 className="text-lg font-medium text-gray-900 mb-3">
            Time Dimensions ({timeDimensions.length})
          </h2>
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {timeDimensions.map((d) => (
                  <tr key={d.name}>
                    <td className="px-4 py-3 text-sm font-mono text-gray-900">{d.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {d.description || <span className="text-gray-400">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {cube.segments.length > 0 && (
        <section>
          <h2 className="text-lg font-medium text-gray-900 mb-3">
            Segments ({cube.segments.length})
          </h2>
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {cube.segments.map((s) => (
                  <tr key={s.name}>
                    <td className="px-4 py-3 text-sm font-mono text-gray-900">{s.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {s.description || <span className="text-gray-400">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
