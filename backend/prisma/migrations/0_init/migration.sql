-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "source_type" AS ENUM ('API', 'DATABASE', 'CRAWLER', 'MQTT');

-- CreateEnum
CREATE TYPE "collection_run_status" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "station" AS ENUM ('RECEIVING', 'SORTING', 'WASHING', 'DRYING', 'FOLDING', 'DISPATCH');

-- CreateEnum
CREATE TYPE "canonical_event_status" AS ENUM ('ACCEPTED', 'CONFLICT');

-- CreateEnum
CREATE TYPE "source_relationship" AS ENUM ('PRIMARY', 'DUPLICATE', 'SUPERSEDED', 'CONFLICT');

-- CreateEnum
CREATE TYPE "management_action" AS ENUM ('BLOCK', 'RESUME', 'ACK_EXCEPTION', 'ADD_NOTE');

-- CreateTable
CREATE TABLE "sources" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "source_type" NOT NULL,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_runs" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "status" "collection_run_status" NOT NULL,
    "records_read" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_records" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "source_record_id" TEXT NOT NULL,
    "collection_run_id" UUID NOT NULL,
    "batch_id" TEXT NOT NULL,
    "station" "station" NOT NULL,
    "payload" JSONB NOT NULL,
    "event_time" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_events" (
    "id" UUID NOT NULL,
    "batch_id" TEXT NOT NULL,
    "station" "station" NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "event_time" TIMESTAMP(3) NOT NULL,
    "status" "canonical_event_status" NOT NULL,
    "canonical_key" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canonical_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_event_sources" (
    "canonical_event_id" UUID NOT NULL,
    "source_record_pk" UUID NOT NULL,
    "relationship" "source_relationship" NOT NULL,

    CONSTRAINT "canonical_event_sources_pkey" PRIMARY KEY ("canonical_event_id","source_record_pk")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" UUID NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" UUID NOT NULL,
    "batch_id" TEXT NOT NULL,
    "work_order_id" UUID NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "management_events" (
    "id" UUID NOT NULL,
    "organization_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" "management_action" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "note" TEXT,

    CONSTRAINT "management_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lines" (
    "id" UUID NOT NULL,
    "line_id" TEXT NOT NULL,
    "name" TEXT,

    CONSTRAINT "lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "collection_runs_source_id_idx" ON "collection_runs"("source_id");

-- CreateIndex
CREATE INDEX "source_records_source_id_source_record_id_idx" ON "source_records"("source_id", "source_record_id");

-- CreateIndex
CREATE INDEX "source_records_batch_id_station_idx" ON "source_records"("batch_id", "station");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_events_canonical_key_key" ON "canonical_events"("canonical_key");

-- CreateIndex
CREATE INDEX "canonical_events_batch_id_idx" ON "canonical_events"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_work_order_id_key" ON "work_orders"("work_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "batches_batch_id_key" ON "batches"("batch_id");

-- CreateIndex
CREATE INDEX "management_events_batch_id_idx" ON "management_events"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "lines_line_id_key" ON "lines"("line_id");

-- AddForeignKey
ALTER TABLE "collection_runs" ADD CONSTRAINT "collection_runs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_collection_run_id_fkey" FOREIGN KEY ("collection_run_id") REFERENCES "collection_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canonical_event_sources" ADD CONSTRAINT "canonical_event_sources_canonical_event_id_fkey" FOREIGN KEY ("canonical_event_id") REFERENCES "canonical_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canonical_event_sources" ADD CONSTRAINT "canonical_event_sources_source_record_pk_fkey" FOREIGN KEY ("source_record_pk") REFERENCES "source_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

