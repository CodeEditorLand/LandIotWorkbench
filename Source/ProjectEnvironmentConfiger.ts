// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

"use strict";

import * as path from "path";
import * as vscode from "vscode";

import { OperationCanceledError } from "./common/Error/OperationCanceledError";
import { WorkspaceNotOpenError } from "./common/Error/OperationFailedErrors/WorkspaceNotOpenError";
import { TypeNotSupportedError } from "./common/Error/SystemErrors/TypeNotSupportedError";
import { PlatformType, ScaffoldType } from "./constants";
import { ProjectHostType } from "./Models/Interfaces/ProjectHostType";
import {
	IoTWorkbenchProjectBase,
	OpenScenario,
} from "./Models/IoTWorkbenchProjectBase";
import { RemoteExtension } from "./Models/RemoteExtension";
import { TelemetryContext } from "./telemetry";
import * as utils from "./utils";
import { configExternalCMakeProjectToIoTContainerProject } from "./utils";

const importLazy = require("import-lazy");

const ioTWorkspaceProjectModule = importLazy(() =>
	require("./Models/IoTWorkspaceProject"),
)();

const ioTContainerizedProjectModule = importLazy(() =>
	require("./Models/IoTContainerizedProject"),
)();

export class ProjectEnvironmentConfiger {
	async configureCmakeProjectEnvironment(
		context: vscode.ExtensionContext,
		channel: vscode.OutputChannel,
		telemetryContext: TelemetryContext,
	): Promise<void> {
		// Only configure project when not in remote environment
		RemoteExtension.ensureLocalBeforeRunCommand(
			"configure CMake project environment",
			context,
		);

		const scaffoldType = ScaffoldType.Local;

		const projectRootPath = utils.getProjectDeviceRootPath();

		if (!projectRootPath) {
			throw new WorkspaceNotOpenError("configure project environment");
		}

		await vscode.window.withProgress(
			{
				title: "CMake Project development container configuration",
				location: vscode.ProgressLocation.Window,
			},
			async () => {
				await ProjectEnvironmentConfiger.configureProjectEnvironmentAsPlatform(
					context,
					channel,
					telemetryContext,
					PlatformType.EmbeddedLinux,
					projectRootPath,
					scaffoldType,
				);

				const message = `Successfully configured development container for CMake project.`;

				utils.channelShowAndAppendLine(channel, message);

				vscode.window.showInformationMessage(message);
			},
		);

		return;
	}

	static async configureProjectEnvironmentAsPlatform(
		context: vscode.ExtensionContext,
		channel: vscode.OutputChannel,
		telemetryContext: TelemetryContext,
		platform: PlatformType,
		projectFileRootPath: string,
		scaffoldType: ScaffoldType,
	): Promise<void> {
		let project;

		if (platform === PlatformType.Arduino) {
			// Verify it is an iot workbench Arduino project
			const projectHostType =
				await IoTWorkbenchProjectBase.getProjectType(
					scaffoldType,
					projectFileRootPath,
				);

			if (projectHostType !== ProjectHostType.Workspace) {
				const message = `This is not an iot workbench Arduino project. You cannot configure it as Arduino platform.`;

				vscode.window.showWarningMessage(message);

				throw new OperationCanceledError(message);
			}

			const projectRootPath = path.join(projectFileRootPath, "..");

			project = new ioTWorkspaceProjectModule.IoTWorkspaceProject(
				context,
				channel,
				telemetryContext,
				projectRootPath,
			);

			if (!project) {
				// Ensure the project is correctly open.
				await utils.properlyOpenIoTWorkspaceProject(telemetryContext);
			}
		} else if (platform === PlatformType.EmbeddedLinux) {
			// If external cmake project, configure to be IoT Workbench container
			// project
			await configExternalCMakeProjectToIoTContainerProject(scaffoldType);

			await RemoteExtension.checkRemoteExtension(
				"configure project environment",
			);

			project = new ioTContainerizedProjectModule.IoTContainerizedProject(
				context,
				channel,
				telemetryContext,
				projectFileRootPath,
			);
		} else {
			throw new TypeNotSupportedError("platform", `${platform}`);
		}

		await project.load(scaffoldType);

		// Add configuration files
		await project.configureProjectEnvironmentCore(
			projectFileRootPath,
			scaffoldType,
		);

		await project.openProject(
			scaffoldType,
			false,
			OpenScenario.configureProject,
		);
	}
}
