import { AwsMcpClient } from "../src/awsMcpClient.js";
import { DocsEvidenceService } from "../src/docsEvidenceService.js";

const question = process.argv.slice(2).join(" ") || "Amazon EBS use case";

const client = new AwsMcpClient();
await client.initialize();

const service = new DocsEvidenceService({ client });
const result = await service.evidence({ question });

console.log(JSON.stringify(result, null, 2));
