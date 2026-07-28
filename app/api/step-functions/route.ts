import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const stateMachineArn =
  process.env.STEP_FUNCTION_ARN ??
  process.env.AWS_STEP_FUNCTION_ARN ??
  "arn:aws:states:us-east-1:066196453068:stateMachine:yt-data-pipeline-orchestration";
const region =
  process.env.AWS_REGION ??
  process.env.AWS_DEFAULT_REGION ??
  stateMachineArn.split(":")[3] ??
  "us-east-1";
const service = "states";
const host = `states.${region}.amazonaws.com`;
const endpoint = `https://${host}/`;

const stateNames = [
  "IngestFromYouTubeAPI",
  "WaitForS3Consistency",
  "ProcessInParallel",
  "TransformReferenceData",
  "RunBronzeToSilverGlueJob",
  "RunDataQualityChecks",
  "EvaluateDataQuality",
  "RunSilverToGoldGlueJob",
  "NotifySuccess",
  "NotifyIngestionFailure",
  "NotifyTransformFailure",
  "NotifyDQFailure",
  "NotifyGoldFailure",
] as const;

type StateName = (typeof stateNames)[number];
type NodeStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
type AwsHistoryEvent = {
  id?: number;
  timestamp?: number;
  type?: string;
  stateEnteredEventDetails?: { name?: string };
  stateExitedEventDetails?: { name?: string };
};

const lastStartedByIp = new Map<string, number>();
const encoder = new TextEncoder();

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value: string) {
  return bytesToHex(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
}

async function hmac(key: ArrayBuffer, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
}

function credentials() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  };
}

async function awsJson<T>(target: string, payload: Record<string, unknown>) {
  const creds = credentials();
  if (!creds) {
    throw new Error(
      "AWS runtime credentials are not configured for this deployment.",
    );
  }

  const body = JSON.stringify(payload);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const targetHeader = `AWSStepFunctions.${target}`;
  const payloadHash = await sha256(body);
  const signedHeaderNames = [
    "content-type",
    "host",
    "x-amz-date",
    ...(creds.sessionToken ? ["x-amz-security-token"] : []),
    "x-amz-target",
  ];
  const canonicalHeaders = [
    "content-type:application/x-amz-json-1.0",
    `host:${host}`,
    `x-amz-date:${amzDate}`,
    ...(creds.sessionToken
      ? [`x-amz-security-token:${creds.sessionToken}`]
      : []),
    `x-amz-target:${targetHeader}`,
    "",
  ].join("\n");
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaderNames.join(";"),
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256(canonicalRequest),
  ].join("\n");
  const dateKey = await hmac(
    encoder.encode(`AWS4${creds.secretAccessKey}`).buffer as ArrayBuffer,
    dateStamp,
  );
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, service);
  const signingKey = await hmac(serviceKey, "aws4_request");
  const signature = bytesToHex(await hmac(signingKey, stringToSign));
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.0",
      "x-amz-date": amzDate,
      "x-amz-target": targetHeader,
      authorization,
      ...(creds.sessionToken
        ? { "x-amz-security-token": creds.sessionToken }
        : {}),
    },
    body,
    cache: "no-store",
  });
  const result = (await response.json()) as T & {
    message?: string;
    Message?: string;
    __type?: string;
  };
  if (!response.ok) {
    throw new Error(
      result.message ??
        result.Message ??
        result.__type ??
        `AWS returned ${response.status}.`,
    );
  }
  return result;
}

function stateFromEvent(event: AwsHistoryEvent) {
  return (
    event.stateEnteredEventDetails?.name ??
    event.stateExitedEventDetails?.name
  ) as StateName | undefined;
}

function summarizeHistory(
  history: AwsHistoryEvent[],
  executionStatus?: string,
) {
  const states = Object.fromEntries(
    stateNames.map((name) => [name, "PENDING" as NodeStatus]),
  ) as Record<StateName, NodeStatus>;

  for (const event of history) {
    const state = stateFromEvent(event);
    if (!state || !(state in states)) continue;
    if (event.type?.endsWith("StateEntered")) states[state] = "RUNNING";
    if (event.type?.endsWith("StateExited")) states[state] = "SUCCEEDED";
  }

  if (["FAILED", "TIMED_OUT", "ABORTED"].includes(executionStatus ?? "")) {
    const activeState = [...history]
      .reverse()
      .map(stateFromEvent)
      .find((name) => name && states[name] === "RUNNING");
    if (activeState) states[activeState] = "FAILED";
  }
  return states;
}

function isoTimestamp(timestamp?: number) {
  return timestamp ? new Date(timestamp * 1000).toISOString() : undefined;
}

async function executionPayload(executionArn: string) {
  const [execution, history] = await Promise.all([
    awsJson<{
      name?: string;
      status?: string;
      startDate?: number;
      stopDate?: number;
      input?: string;
      output?: string;
    }>("DescribeExecution", { executionArn }),
    awsJson<{ events?: AwsHistoryEvent[] }>("GetExecutionHistory", {
      executionArn,
      maxResults: 100,
      reverseOrder: false,
    }),
  ]);
  const events = history.events ?? [];
  return {
    configured: true,
    executionArn,
    name: execution.name,
    status: execution.status,
    startedAt: isoTimestamp(execution.startDate),
    stoppedAt: isoTimestamp(execution.stopDate),
    input: execution.input,
    output: execution.output,
    states: summarizeHistory(events, execution.status),
    events: events
      .slice(-12)
      .reverse()
      .map((event) => ({
        id: event.id,
        timestamp: isoTimestamp(event.timestamp),
        type: event.type,
        state: stateFromEvent(event),
      })),
  };
}

export async function GET(request: NextRequest) {
  const executionArn = request.nextUrl.searchParams.get("executionArn");
  try {
    if (executionArn) return NextResponse.json(await executionPayload(executionArn));

    const executions = await awsJson<{
      executions?: Array<{ executionArn?: string }>;
    }>("ListExecutions", { stateMachineArn, maxResults: 1 });
    const latestExecutionArn = executions.executions?.[0]?.executionArn;
    if (latestExecutionArn) {
      return NextResponse.json(await executionPayload(latestExecutionArn));
    }
    return NextResponse.json({
      configured: true,
      region,
      stateMachineArn,
      status: "IDLE",
    });
  } catch {
    return NextResponse.json({
      configured: false,
      region,
      stateMachineArn,
      status: "IDLE",
    });
  }
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const requestHosts = new Set(
    [
      request.nextUrl.host,
      request.headers.get("host"),
      request.headers.get("x-forwarded-host")?.split(",")[0]?.trim(),
    ].filter(Boolean),
  );
  let originAllowed = !origin || fetchSite === "same-origin";
  if (origin && !originAllowed) {
    try {
      originAllowed = requestHosts.has(new URL(origin).host);
    } catch {
      originAllowed = false;
    }
  }
  if (!originAllowed) {
    return NextResponse.json(
      { error: "Cross-origin execution requests are not allowed." },
      { status: 403 },
    );
  }

  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  if (now - (lastStartedByIp.get(clientIp) ?? 0) < 60_000) {
    return NextResponse.json(
      { error: "Please wait one minute before starting another execution." },
      { status: 429 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const executionName = `trendforge-${new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, "")
      .slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`;
    const started = await awsJson<{ executionArn?: string }>("StartExecution", {
      stateMachineArn,
      name: executionName,
      input: JSON.stringify({
        triggered_by: "trendforge_live_demo",
        regions:
          Array.isArray(body.regions) && body.regions.length
            ? body.regions
            : ["US", "GB", "CA", "DE", "FR", "IN", "JP", "KR", "MX", "RU"],
        requested_at: new Date().toISOString(),
      }),
    });
    lastStartedByIp.set(clientIp, now);
    return NextResponse.json(
      await executionPayload(started.executionArn!),
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        configured: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to start the Step Functions execution.",
      },
      { status: 502 },
    );
  }
}
