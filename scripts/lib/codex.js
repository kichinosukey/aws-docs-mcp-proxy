const AWS_DOCS_HEADER = "[mcp_servers.aws_docs]";

export function hasAwsDocsToml(text) {
  return text.includes(AWS_DOCS_HEADER);
}

function escapeTomlString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function upsertAwsDocsCommand(text, command) {
  const escaped = escapeTomlString(command);
  const commandLine = `command = "${escaped}"`;

  if (!hasAwsDocsToml(text)) {
    const suffix = text.endsWith("\n") ? "" : "\n";
    return `${text}${suffix}\n${AWS_DOCS_HEADER}\n${commandLine}\n`;
  }

  const lines = text.split("\n");
  const headerIndex = lines.findIndex((line) => line.trim() === AWS_DOCS_HEADER);
  if (headerIndex === -1) {
    throw new Error("aws_docs header found but not on its own line");
  }

  let endIndex = lines.length;
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.startsWith("[") && !line.startsWith("[mcp_servers.aws_docs.")) {
      endIndex = i;
      break;
    }
  }

  const block = lines.slice(headerIndex + 1, endIndex);
  const commandIdx = block.findIndex((line) => line.trim().startsWith("command"));
  if (commandIdx === -1) {
    block.unshift(commandLine);
  } else {
    block[commandIdx] = commandLine;
  }

  const rebuilt = [
    ...lines.slice(0, headerIndex + 1),
    ...block,
    ...lines.slice(endIndex)
  ];
  return `${rebuilt.join("\n").replace(/\n*$/, "\n")}`;
}
