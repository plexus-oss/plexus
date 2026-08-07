"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CodeBlock } from "./code-block";
import { Terminal, Cpu, Bot, Globe } from "lucide-react";

interface HardwareTabsProps {
  apiKey: string;
  sourceId: string;
}

export function HardwareTabs({ apiKey, sourceId }: HardwareTabsProps) {
  const displayKey = apiKey || "YOUR_API_KEY";
  const displaySourceId = sourceId || "my-source-001";

  const snippets = {
    linux: `from plexus import Plexus

px = Plexus(api_key="${displayKey}", source_id="${displaySourceId}")

px.send("temperature", 72.5)
px.send("battery_mv", 3700, tags={"board": "v2"})

# Batch multiple metrics at once
px.send_batch([
    ("temperature", 72.5),
    ("humidity",    54.1),
])`,

    arduino: `#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* apiKey  = "${displayKey}";
const char* sourceId = "${displaySourceId}";

void sendTelemetry(const char* metric, float value) {
  HTTPClient http;
  http.begin("https://gateway.plexus.company/ingest");
  http.addHeader("x-api-key", apiKey);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<200> doc;
  doc["source_id"] = sourceId;
  JsonArray points = doc.createNestedArray("points");
  JsonObject point = points.createNestedObject();
  point["metric"] = metric;
  point["value"]  = value;

  String body;
  serializeJson(doc, body);
  http.POST(body);
  http.end();
}

void loop() {
  sendTelemetry("temperature", 72.5);
  delay(1000);
}`,

    ros: `from plexus import Plexus
from rclpy.node import Node

class PlexusBridge(Node):
    def __init__(self):
        super().__init__('plexus_bridge')
        self.px = Plexus(
            api_key="${displayKey}",
            source_id="${displaySourceId}",
        )

    def send(self, metric: str, value: float):
        self.px.send(metric, value)

# In your subscriber callback:
# self.send("joint.shoulder", msg.position[0])`,

    http: `curl -X POST https://gateway.plexus.company/ingest \\
  -H "x-api-key: ${displayKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"source_id":"${displaySourceId}","points":[{"metric":"temperature","value":72.5}]}'`,
  };

  return (
    <Tabs defaultValue="linux" className="w-full">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="linux" className="text-xs">
          <Terminal className="h-3 w-3 mr-1" />
          Linux/Pi
        </TabsTrigger>
        <TabsTrigger value="arduino" className="text-xs">
          <Cpu className="h-3 w-3 mr-1" />
          Arduino
        </TabsTrigger>
        <TabsTrigger value="ros" className="text-xs">
          <Bot className="h-3 w-3 mr-1" />
          ROS
        </TabsTrigger>
        <TabsTrigger value="http" className="text-xs">
          <Globe className="h-3 w-3 mr-1" />
          HTTP
        </TabsTrigger>
      </TabsList>

      <TabsContent value="linux" className="mt-4">
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Works on Raspberry Pi, Jetson, or any device with Python. Install
            the SDK: pip install plexus-python
          </p>
          <CodeBlock code={snippets.linux} language="python" />
        </div>
      </TabsContent>

      <TabsContent value="arduino" className="mt-4">
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            For ESP32, ESP8266, or Arduino with WiFi. Uses HTTPClient library.
          </p>
          <CodeBlock code={snippets.arduino} language="cpp" />
        </div>
      </TabsContent>

      <TabsContent value="ros" className="mt-4">
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            ROS 2 Python node example. Subscribe to topics and forward to
            Plexus.
          </p>
          <CodeBlock code={snippets.ros} language="python" />
        </div>
      </TabsContent>

      <TabsContent value="http" className="mt-4">
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Works from any device that can make HTTP requests. Test with curl.
          </p>
          <CodeBlock code={snippets.http} language="bash" />
        </div>
      </TabsContent>
    </Tabs>
  );
}
