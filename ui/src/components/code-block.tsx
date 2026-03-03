import { CopyButton } from "./copy-button";

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
      {label && (
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 bg-white">
          <span className="text-xs font-medium text-gray-500">{label}</span>
          <CopyButton text={code} />
        </div>
      )}
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed text-gray-800">
        <code>{code}</code>
      </pre>
      {!label && (
        <div className="flex justify-end border-t border-gray-200 px-2 py-1 bg-white">
          <CopyButton text={code} />
        </div>
      )}
    </div>
  );
}
