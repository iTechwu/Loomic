import amqp, { type Channel, type ConsumeMessage } from "amqplib";

import {
  logOperationalFailure,
  logOperationalWarning,
} from "../utils/operational-log.js";

export type RabbitMessage<T = Record<string, unknown>> = {
  deliveryTag: number;
  payload: T;
  raw: ConsumeMessage;
};

export type RabbitMqClient = {
  close(): Promise<void>;
  consume<T>(queue: string, handler: (message: RabbitMessage<T>) => Promise<void>, options: { prefetch: number }): Promise<void>;
  publish(queue: string, payload: Record<string, unknown>): Promise<void>;
  ping(): Promise<void>;
};

/**
 * A single lazy AMQP connection for a process. Messages are persistent and
 * consumers acknowledge only after the PostgreSQL state transition succeeds.
 */
export function createRabbitMqClient(url: string): RabbitMqClient {
  let connection: amqp.ChannelModel | undefined;
  let publisher: Channel | undefined;

  async function getPublisher() {
    if (publisher) return publisher;
    connection = await amqp.connect(url);
    connection.on("error", () =>
      logOperationalFailure("[rabbitmq] connection error", "rabbitmq_connection"),
    );
    connection.on("close", () => {
      logOperationalWarning("[rabbitmq] connection closed", "rabbitmq_connection_closed");
      connection = undefined;
      publisher = undefined;
    });
    publisher = await connection.createChannel();
    await publisher.assertExchange("lovart.jobs", "direct", { durable: true });
    return publisher;
  }

  async function assertQueue(channel: Channel, queue: string) {
    await channel.assertQueue(queue, { durable: true, arguments: { "x-queue-type": "quorum" } });
    await channel.bindQueue(queue, "lovart.jobs", queue);
  }

  return {
    async publish(queue, payload) {
      const channel = await getPublisher();
      await assertQueue(channel, queue);
      const accepted = channel.publish("lovart.jobs", queue, Buffer.from(JSON.stringify(payload)), {
        contentType: "application/json",
        deliveryMode: 2,
        messageId: typeof payload.job_id === "string" ? payload.job_id : undefined,
        timestamp: Math.floor(Date.now() / 1000),
      });
      if (!accepted) await new Promise<void>((resolve) => channel.once("drain", resolve));
    },
    async consume(queue, handler, options) {
      const channel = await getPublisher();
      await assertQueue(channel, queue);
      await channel.prefetch(options.prefetch);
      await channel.consume(queue, (raw) => {
        if (!raw) return;
        void (async () => {
          try {
            const payload = JSON.parse(raw.content.toString("utf8")) as Record<string, unknown>;
            await handler({ deliveryTag: raw.fields.deliveryTag, payload: payload as never, raw });
            channel.ack(raw);
          } catch {
            logOperationalFailure(
              "[rabbitmq] message failed",
              "rabbitmq_message_handler",
            );
            // Job status and retry policy are authoritative in PostgreSQL. A failed
            // message is requeued only while the worker handling it is alive.
            channel.nack(raw, false, true);
          }
        })();
      }, { noAck: false });
    },
    async ping() {
      const channel = await getPublisher();
      await channel.checkExchange("lovart.jobs");
    },
    async close() {
      await publisher?.close().catch(() => undefined);
      publisher = undefined;
      await connection?.close().catch(() => undefined);
      connection = undefined;
    },
  };
}
