// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

"use strict";

import * as path from "path";
import * as vscode from "vscode";

import { OperationCanceledError } from "./common/Error/OperationCanceledError";
import { ResourceNotFoundError } from "./common/Error/OperationFailedErrors/ResourceNotFoundError";
import { TypeNotSupportedError } from "./common/Error/SystemErrors/TypeNotSupportedError";
import {
	FileNames,
	PlatformType,
	ScaffoldType,
	TemplateTag,
} from "./constants";
import { FileUtility } from "./FileUtility";
import { IoTWorkbenchSettings } from "./IoTSettings";
import {
	ProjectTemplate,
	ProjectTemplateType,
	TemplatesType,
} from "./Models/Interfaces/ProjectTemplate";
import { RemoteExtension } from "./Models/RemoteExtension";
import { TelemetryContext } from "./telemetry";
import * as utils from "./utils";

const importLazy = require("import-lazy");

const ioTWorkspaceProjectModule = importLazy(() =>
	require("./Models/IoTWorkspaceProject"),
)();

const ioTContainerizedProjectModule = importLazy(() =>
	require("./Models/IoTContainerizedProject"),
)();

const constants = {
	defaultProjectName: "IoTproject",
	noDeviceMessage: "$(issue-opened) My device is not in the list...",
	embeddedLinuxProjectName: "Embedded Linux Project",
};

export class ProjectInitializer {
	async InitializeProject(
		context: vscode.ExtensionContext,
		channel: vscode.OutputChannel,
		telemetryContext: TelemetryContext,
	): Promise<void> {
		// Only create project when not in remote environment
		RemoteExtension.ensureLocalBeforeRunCommand("init project", context);

		let openInNewWindow = false;
		// If current window contains other project, open the created project in new
		// window.
		if (
			vscode.workspace.workspaceFolders &&
			vscode.workspace.workspaceFolders.length > 0
		) {
			openInNewWindow = true;
		}

		// Initial project
		await vscode.window.withProgress(
			{
				title: "Project initialization",
				location: vscode.ProgressLocation.Window,
			},
			async (progress) => {
				progress.report({
					message: "Updating a list of available template",
				});

				const scaffoldType = ScaffoldType.Local;

				// Step 1: Get project name
				const projectPath = await this.generateProjectFolder(
					telemetryContext,
					scaffoldType,
				);

				if (!projectPath) {
					throw new OperationCanceledError(
						`Project initialization cancelled: Project name input cancelled.`,
					);
				}

				// Step 2: Select platform
				const platformSelection = await utils.selectPlatform(
					scaffoldType,
					context,
				);

				if (!platformSelection) {
					throw new OperationCanceledError(
						`Project initialization cancelled: Platform selection cancelled.`,
					);
				} else {
					telemetryContext.properties.platform =
						platformSelection.label;
				}

				// Step 3: Select template
				const templateJson = await utils.getTemplateJson(
					context,
					scaffoldType,
				);

				let templateName: string | undefined;

				if (platformSelection.label === PlatformType.Arduino) {
					const templateSelection = await this.selectTemplate(
						templateJson,
						PlatformType.Arduino,
					);

					if (!templateSelection) {
						throw new OperationCanceledError(
							`Project initialization cancelled: Project template selection cancelled.`,
						);
					} else {
						telemetryContext.properties.template =
							templateSelection.label;

						if (
							templateSelection.label ===
							constants.noDeviceMessage
						) {
							await utils.takeNoDeviceSurvey(
								telemetryContext,
								context,
							);

							return;
						}
					}

					templateName = templateSelection.label;
				} else {
					// If choose Embedded Linux platform, generate C project template
					// directly
					templateName = constants.embeddedLinuxProjectName;
				}

				const template: ProjectTemplate = templateJson.templates.find(
					(template: ProjectTemplate) => {
						return (
							template.platform === platformSelection.label &&
							template.name === templateName
						);
					},
				);

				if (!template) {
					throw new ResourceNotFoundError(
						"initialize iot project",
						`project template in template json file with the given template name ${templateName} \
            and platform ${platformSelection.label}`,
						"",
					);
				}

				// Step 4: Load the list of template files
				const projectTemplateType: ProjectTemplateType =
					utils.getEnumKeyByEnumValue(
						ProjectTemplateType,
						template.type,
					);

				const resourceRootPath = context.asAbsolutePath(
					path.join(
						FileNames.resourcesFolderName,
						FileNames.templatesFolderName,
					),
				);

				const templateFolder = path.join(
					resourceRootPath,
					template.path,
				);

				const templateFilesInfo =
					await utils.getTemplateFilesInfo(templateFolder);

				let project;

				if (template.platform === PlatformType.EmbeddedLinux) {
					project =
						new ioTContainerizedProjectModule.IoTContainerizedProject(
							context,
							channel,
							telemetryContext,
							projectPath,
						);
				} else if (template.platform === PlatformType.Arduino) {
					project = new ioTWorkspaceProjectModule.IoTWorkspaceProject(
						context,
						channel,
						telemetryContext,
						projectPath,
					);
				} else {
					throw new TypeNotSupportedError(
						"platform",
						`${template.platform}`,
					);
				}

				await project.create(
					templateFilesInfo,
					projectTemplateType,
					template.boardId,
					openInNewWindow,
				);
			},
		);
	}

	private async selectTemplate(
		templateJson: TemplatesType,
		platform: string,
	): Promise<vscode.QuickPickItem | undefined> {
		const result = templateJson.templates.filter(
			(template: ProjectTemplate) => {
				return (
					template.platform === platform &&
					template.tag === TemplateTag.General
				);
			},
		);

		const projectTemplateList: vscode.QuickPickItem[] = [];

		result.forEach((element: ProjectTemplate) => {
			projectTemplateList.push({
				label: element.name,
				description: element.description,
				detail: element.detail,
			});
		});

		const templateSelection = await vscode.window.showQuickPick(
			projectTemplateList,
			{
				ignoreFocusOut: true,
				matchOnDescription: true,
				matchOnDetail: true,
				placeHolder: "Select a project template",
			},
		);

		return templateSelection;
	}

	private async generateProjectFolder(
		telemetryContext: TelemetryContext,
		scaffoldType: ScaffoldType,
	): Promise<string | undefined> {
		// Get default workbench path.
		const settings = await IoTWorkbenchSettings.getInstance();

		const workbench = settings.getWorkbenchPath();

		const projectRootPath = path.join(workbench, "projects");

		if (
			!(await FileUtility.directoryExists(scaffoldType, projectRootPath))
		) {
			await FileUtility.mkdirRecursively(scaffoldType, projectRootPath);
		}

		let counter = 0;

		const name = constants.defaultProjectName;

		let candidateName = name;
		/*eslint no-constant-condition: ["error", { "checkLoops": false }]*/
		while (true) {
			const projectPath = path.join(projectRootPath, candidateName);

			const isValid = await this.isProjectPathValid(
				scaffoldType,
				projectPath,
			);

			if (isValid) {
				break;
			}

			counter++;

			candidateName = `${name}_${counter}`;
		}

		const projectName = await vscode.window.showInputBox({
			value: candidateName,
			prompt: "Input project name.",
			ignoreFocusOut: true,
			validateInput: async (projectName: string) => {
				if (
					!/^([a-z0-9_]|[a-z0-9_][-a-z0-9_.]*[a-z0-9_])(\.ino)?$/i.test(
						projectName,
					)
				) {
					return 'Project name can only contain letters, numbers, "-" and ".", and cannot start or end with "-" or ".".';
				}

				const projectPath = path.join(projectRootPath, projectName);

				const isProjectNameValid = await this.isProjectPathValid(
					scaffoldType,
					projectPath,
				);

				if (isProjectNameValid) {
					return;
				} else {
					return `${projectPath} exists, please choose another name.`;
				}
			},
		});

		if (projectName) {
			const projectNameMd5 = utils.getHashFromString(projectName);

			telemetryContext.properties.projectName = projectNameMd5;
		}

		const projectPath = projectName
			? path.join(projectRootPath, projectName)
			: undefined;

		// We don't create the projectpath here in case user may cancel their
		// initialization in following steps Just generate a valid path for project
		return projectPath;
	}

	private async isProjectPathValid(
		scaffoldType: ScaffoldType,
		projectPath: string,
	): Promise<boolean> {
		const projectPathExists = await FileUtility.fileExists(
			scaffoldType,
			projectPath,
		);

		const projectDirectoryExists = await FileUtility.directoryExists(
			scaffoldType,
			projectPath,
		);

		return !projectPathExists && !projectDirectoryExists;
	}
}
