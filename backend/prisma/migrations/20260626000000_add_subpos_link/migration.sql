-- CreateTable
CREATE TABLE "SubPosLink" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "mainDeviceCode" TEXT NOT NULL,
    "subDeviceCode" TEXT NOT NULL,
    "mainDeviceId" TEXT NOT NULL,
    "subDeviceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "allowPrint" BOOLEAN NOT NULL DEFAULT true,
    "allowDrawer" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubPosLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubPosLink_shopId_mainDeviceCode_subDeviceCode_key" ON "SubPosLink"("shopId", "mainDeviceCode", "subDeviceCode");

-- CreateIndex
CREATE INDEX "SubPosLink_shopId_mainDeviceCode_idx" ON "SubPosLink"("shopId", "mainDeviceCode");

-- CreateIndex
CREATE INDEX "SubPosLink_shopId_subDeviceId_idx" ON "SubPosLink"("shopId", "subDeviceId");

-- AddForeignKey
ALTER TABLE "SubPosLink" ADD CONSTRAINT "SubPosLink_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
