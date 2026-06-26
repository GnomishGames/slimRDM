import { Terminal } from "@xterm/xterm";

export function createLinkHandler(term: Terminal) {
  return (event: MouseEvent, uri: string) => {
    event.preventDefault();
    navigator.clipboard.writeText(uri)
      .then(() => {
        term.writeln(`\r\n\x1b[36m● Copied: ${uri}\x1b[0m`);
      })
      .catch(() => {
        term.writeln(`\r\n\x1b[31m● Failed to copy: ${uri}\x1b[0m`);
      });
  };
}
