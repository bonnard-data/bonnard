import { NavLink, Outlet } from "react-router-dom";

const links = [
  { to: "/", label: "Status" },
  { to: "/schema", label: "Schema" },
  { to: "/mcp", label: "MCP" },
];

export function App() {
  return (
    <div className="min-h-screen">
      <nav className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="flex h-14 items-center gap-8">
            <span className="text-lg font-semibold tracking-tight text-gray-900">
              Bonnard
            </span>
            <div className="flex gap-1">
              {links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === "/"}
                  className={({ isActive }) =>
                    `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-gray-100 text-gray-900"
                        : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                    }`
                  }
                >
                  {link.label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
