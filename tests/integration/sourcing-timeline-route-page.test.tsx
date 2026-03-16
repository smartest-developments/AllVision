
describe("timeline route post-ack settlement note precedence (AT-AUTO-UI-168)", () => {
  it("renders timeline trimmed post-ack payload settlement note when repeated trailing mixed-width separators span eighty-eight terminal lines", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-eight-line-trailing-mixed-space-separator-owner@example.com",
        passwordHash: "hash",
        role: "USER",
      },
    });
    const admin = await prisma.user.create({
      data: {
        email: "timeline-route-post-ack-eighty-eight-line-trailing-mixed-space-separator-admin@example.com",
        passwordHash: "hash",
        role: "ADMIN",
      },
    });

    const prescription = await prisma.prescription.create({
      data: {
        userId: owner.id,
        countryCode: "CH",
        payload: {
          countryCode: "CH",
          leftEye: { sphere: -1.0 },
          rightEye: { sphere: -0.75 },
          pupillaryDistance: 61,
        },
      },
    });

    const settledRequest = await prisma.sourcingRequest.create({
      data: {
        userId: owner.id,
        prescriptionId: prescription.id,
        status: "DELIVERED",
        reportPaymentRequired: true,
        reportFeeCents: 1990,
        currency: "EUR",
      },
    });

    const trailingSeparators = Array.from({ length: 88 }, (_, index) =>
      index % 2 === 0 ? "\n\t\t\t" : "\n    ",
    ).join("");

    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_PENDING",
        toStatus: "PAYMENT_SETTLED",
        actorUserId: admin.id,
        note:
          "\n\t  Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three." +
          trailingSeparators +
          "\n",
        createdAt: new Date("2026-03-10T11:29:00.000Z"),
      },
    });
    await prisma.sourcingStatusEvent.create({
      data: {
        sourcingRequestId: settledRequest.id,
        fromStatus: "PAYMENT_SETTLED",
        toStatus: "DELIVERED",
        actorUserId: owner.id,
        note: "Owner acknowledged report delivery.",
        createdAt: new Date("2026-03-10T11:29:00.000Z"),
      },
    });

    mockedResolvePageSessionIdentity.mockResolvedValue({ userId: owner.id, role: "USER" });

    const markup = renderToStaticMarkup(
      await TimelinePage({
        searchParams: Promise.resolve({
          requestId: settledRequest.id,
          ack: "1",
          settledAt: "1999-01-01T00:00:00.000Z",
          settledByRole: "USER",
          settledByUserId: "redirect-fallback-user-id",
          settledByUserEmail: "redirect-fallback@example.com",
          settlementEventId: "redirect-fallback-event-id",
          settlementNote: "redirect-fallback-note",
        }),
      }),
    );

    expect(markup).toContain("Delivery acknowledgment recorded.");
    expect(markup).toContain("Settlement was completed at 2026-03-10T11:29:00.000Z by an admin.");
    expect(markup).toContain(
      "Settlement note: Timeline payload note line one.\n\nTimeline payload note line two.\n\nTimeline payload note line three.",
    );
    expect(markup).not.toContain("Settlement note: redirect-fallback-note.");
  });
});
