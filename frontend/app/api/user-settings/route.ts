import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { userSettingsQueries } from "@/lib/db";

/**
 * GET /api/user-settings - Get current user's settings
 */
export async function GET() {
  try {
    const { userId } = await getAuth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await userSettingsQueries.findByUserId(userId);
    const settings = result[0];

    if (!settings) {
      // Return defaults if no settings exist yet
      return NextResponse.json({
        settings: {
          timezone: "UTC",
          use12HourFormat: false,
        },
      });
    }

    return NextResponse.json({
      settings: {
        timezone: settings.timezone,
        use12HourFormat: settings.use_12_hour_format,
      },
    });
  } catch (error) {
    console.error("User settings GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/user-settings - Update current user's settings
 */
export async function PATCH(request: NextRequest) {
  try {
    const { userId } = await getAuth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    const updates: Record<string, unknown> = {};

    if (body.timezone !== undefined) {
      updates.timezone = body.timezone;
    }

    if (body.use12HourFormat !== undefined) {
      updates.use_12_hour_format = body.use12HourFormat;
    }

    const result = await userSettingsQueries.upsert(userId, updates);
    const settings = result[0];

    return NextResponse.json({
      settings: {
        timezone: settings.timezone,
        use12HourFormat: settings.use_12_hour_format,
      },
    });
  } catch (error) {
    console.error("User settings PATCH error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
