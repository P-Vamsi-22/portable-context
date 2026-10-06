import * as vscode from "vscode";
import { ContextController } from "./core/contextController";

export function activate(context: vscode.ExtensionContext) {
  const controller = new ContextController(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ContextController.viewId,
      controller,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.commands.registerCommand("portable-context.refreshContext", () => controller.refreshContext()),
    vscode.commands.registerCommand("portable-context.showPanel", () => controller.showPanel()),
    vscode.commands.registerCommand("portable-context.openProject", () => controller.openProject()),
    vscode.commands.registerCommand("portable-context.newProject", () => controller.newProject()),
  );

  controller.initialize();
}

export function deactivate() {
  // no-op
}
