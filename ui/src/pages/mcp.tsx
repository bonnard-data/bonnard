import { useEffect, useState } from "react";
import { api, type McpSession } from "../lib/api";
import { CopyButton } from "../components/copy-button";
import { CodeBlock } from "../components/code-block";

function timeAgo(ts: number): string {
  if (!ts) return "unknown";
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

function snippets(mcpUrl: string) {
  return {
    claudeDesktop: `{
  "mcpServers": {
    "bonnard": {
      "url": "${mcpUrl}"
    }
  }
}`,
    claudeCode: `claude mcp add bonnard --transport http "${mcpUrl}"`,
    cursor: `{
  "mcpServers": {
    "bonnard": {
      "url": "${mcpUrl}"
    }
  }
}`,
    curl: `curl -X POST ${mcpUrl} \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-03-26",
      "capabilities": {},
      "clientInfo": { "name": "curl", "version": "1.0" }
    },
    "id": 1
  }'`,
  };
}

export function McpPage() {
  const [sessions, setSessions] = useState<McpSession[]>([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const mcpUrl = `${window.location.origin}/mcp`;
  const snips = snippets(mcpUrl);

  useEffect(() => {
    api
      .mcpSessions()
      .then((res) => {
        setSessions(res.sessions);
        setSessionCount(res.count);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">MCP Server</h1>
        <p className="mt-1 text-sm text-gray-500">
          Connect AI assistants to your semantic layer via the Model Context Protocol.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-gray-900">Server URL</h2>
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-4">
          <code className="flex-1 text-sm font-mono text-gray-900 break-all">{mcpUrl}</code>
          <CopyButton text={mcpUrl} />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium text-gray-900">Client Configuration</h2>

        <div className="space-y-4">
          <CodeBlock label="Claude Desktop (claude_desktop_config.json)" code={snips.claudeDesktop} />
          <CodeBlock label="Claude Code (CLI)" code={snips.claudeCode} />
          <CodeBlock label="Cursor (.cursor/mcp.json)" code={snips.cursor} />
          <CodeBlock label="curl" code={snips.curl} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-gray-900">
          Active Sessions
          {!loading && (
            <span className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
              {sessionCount}
            </span>
          )}
        </h2>

        {loading ? (
          <p className="text-sm text-gray-500">Loading sessions...</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-gray-500">No active sessions.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Session
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Client
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Last Activity
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3 text-sm font-mono text-gray-700">
                      {s.id.slice(0, 8)}...
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {s.clientName || <span className="text-gray-400">Unknown</span>}
                      {s.clientVersion && (
                        <span className="ml-1 text-gray-400">v{s.clientVersion}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-500">
                      {timeAgo(s.lastActivity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
