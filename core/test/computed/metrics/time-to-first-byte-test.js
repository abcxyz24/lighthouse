/**
 * @license Copyright 2023 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import {TimeToFirstByte} from '../../../computed/metrics/time-to-first-byte.js';
import {createTestTrace} from '../../create-test-trace.js';
import {networkRecordsToDevtoolsLog} from '../../network-records-to-devtools-log.js';
import {defaultSettings} from '../../../config/constants.js';
import {readJson, getURLArtifactFromDevtoolsLog} from '../../test-utils.js';

const trace = readJson('../../fixtures/traces/frame-metrics-m90.json', import.meta);
const devtoolsLog = readJson('../../fixtures/traces/frame-metrics-m90.devtools.log.json', import.meta);

let requestedUrl = 'http://example.com:3000';
let mainDocumentUrl = 'http://www.example.com:3000';

function mockData(networkRecords) {
  return {
    settings: JSON.parse(JSON.stringify(defaultSettings)),
    trace: createTestTrace({
      traceEnd: 6000,
      largestContentfulPaint: 4500,
    }),
    devtoolsLog: networkRecordsToDevtoolsLog(networkRecords),
    URL: {
      requestedUrl,
      mainDocumentUrl,
      finalDisplayedUrl: mainDocumentUrl,
    },
    gatherContext: {gatherMode: 'navigation'},
  };
}

function mockNetworkRecords() {
  return [{
    requestId: '2',
    priority: 'High',
    isLinkPreload: false,
    networkRequestTime: 0,
    networkEndTime: 300,
    timing: {sendEnd: 0},
    transferSize: 300,
    url: requestedUrl,
    frameId: 'ROOT_FRAME',
  },
  {
    requestId: '2:redirect',
    resourceType: 'Document',
    priority: 'High',
    isLinkPreload: false,
    networkRequestTime: 300,
    responseHeadersEndTime: 400,
    networkEndTime: 500,
    timing: {sendEnd: 0, receiveHeadersStart: 100},
    transferSize: 16_000,
    url: mainDocumentUrl,
    frameId: 'ROOT_FRAME',
  }];
}

describe('Metrics: TTFB', () => {
  beforeEach(() => {
    requestedUrl = 'http://example.com:3000';
    mainDocumentUrl = 'http://www.example.com:3000';
  });

  it('should return TTFB for real trace', async () => {
    const data = {
      settings: JSON.parse(JSON.stringify(defaultSettings)),
      trace,
      devtoolsLog,
      URL: getURLArtifactFromDevtoolsLog(devtoolsLog),
      gatherContext: {gatherMode: 'navigation'},
    };

    const context = {settings: data.settings, computedCache: new Map()};
    const result = await TimeToFirstByte.request(data, context);

    expect(result.timing).toBeCloseTo(1014.7, 0.1);
    expect(result.timestamp).toBeUndefined();
  });

  it('should compute predicted value', async () => {
    const networkRecords = mockNetworkRecords();
    const data = mockData(networkRecords);

    const context = {settings: data.settings, computedCache: new Map()};
    const result = await TimeToFirstByte.request(data, context);

    // 3 * 150 RTT + 99 server response time
    // 99 Comes from (100ms observed TTFB - 1ms observed RTT)
    expect(result.timing).toEqual(549);
    expect(result.timestamp).toBeUndefined();
  });

  it('should compute predicted value with SSL', async () => {
    mainDocumentUrl = 'https://www.example.com:3000';
    const networkRecords = mockNetworkRecords();
    const data = mockData(networkRecords);

    const context = {settings: data.settings, computedCache: new Map()};
    const result = await TimeToFirstByte.request(data, context);

    // 4 * 150 RTT + 99.1 server response time
    // 99.1 Comes from (100ms observed TTFB - 0.9ms observed RTT)
    expect(result.timing).toEqual(699.1);
    expect(result.timestamp).toBeUndefined();
  });

  it('should compute an observed value', async () => {
    const networkRecords = mockNetworkRecords();
    const data = mockData(networkRecords);
    data.settings.throttlingMethod = 'provided';

    const context = {settings: data.settings, computedCache: new Map()};
    const result = await TimeToFirstByte.request(data, context);

    expect(result.timing).toEqual(400);
    expect(result.timestamp).toEqual(400_000);
  });
});
