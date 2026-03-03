import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type HealthResponse, type ConfigResponse } from "../lib/api";
import { StatusDot } from "../components/status-dot";

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function StatusPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.health(), api.config()])
      .then(([h, c]) => {
        setHealth(h);
        setConfig(c);
      })
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
        <h2 className="text-sm font-semibold text-red-800">Failed to connect</h2>
        <p className="mt-1 text-sm text-red-700">{error}</p>
      </div>
    );
  }

  if (!health || !config) {
    return <div className="text-sm text-gray-500">Loading...</div>;
  }

  const cubeOk = health.cube === "connected";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Status</h1>
        <p className="mt-1 text-sm text-gray-500">Server health and configuration overview.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <StatusDot ok={cubeOk} />
            <h3 className="text-sm font-medium text-gray-900">Cube API</h3>
          </div>
          <p className="mt-3 text-sm text-gray-600">
            {cubeOk ? "Connected and responding" : "Unreachable"}
          </p>
          <p className="mt-1 text-xs text-gray-400 font-mono break-all">{health.cubeApiUrl}</p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-medium text-gray-900">Server Info</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Version</dt>
              <dd className="font-mono text-gray-900">{config.version}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Uptime</dt>
              <dd className="font-mono text-gray-900">{formatUptime(config.uptime_ms)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Auth enabled</dt>
              <dd className="text-gray-900">{config.hasAuth ? "Yes" : "No"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Cube secret</dt>
              <dd className="text-gray-900">{config.hasCubeSecret ? "Set" : "Not set"}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="flex gap-3">
        <Link
          to="/schema"
          className="inline-flex items-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
        >
          Browse schema
        </Link>
        <Link
          to="/mcp"
          className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          MCP setup
        </Link>
      </div>
    </div>
  );
}
