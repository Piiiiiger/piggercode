import { AGENT_IDS, getAgentBehavior, getAgentCore } from '@/agents/catalog/catalog';
import { isAgentOffered } from '@/agents/catalog/enabled';

export function listSessionGettingStartedCliCommands(commandName = 'happier'): readonly string[] {
    const commands = [commandName];

    for (const agentId of AGENT_IDS) {
        if (!isAgentOffered(agentId) || getAgentBehavior(agentId).guidance?.includeInSessionGettingStartedCliExamples !== true) {
            continue;
        }

        commands.push(`${commandName} ${getAgentCore(agentId).cli.detectKey}`);
    }

    return commands;
}
