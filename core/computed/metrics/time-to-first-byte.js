/**
 * @license Copyright 2023 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import {makeComputedArtifact} from '../computed-artifact.js';
import {NavigationMetric} from './navigation-metric.js';
import {MainResource} from '../main-resource.js';
import {NetworkAnalysis} from '../network-analysis.js';

class TimeToFirstByte extends NavigationMetric {
  /**
   * @param {LH.Artifacts.NavigationMetricComputationData} data
   * @param {LH.Artifacts.ComputedContext} context
   * @return {Promise<LH.Artifacts.Metric>}
   */
  static async computeSimulatedMetric(data, context) {
    const mainResource = await MainResource.request(data, context);
    const networkAnalysis = await NetworkAnalysis.request(data.devtoolsLog, context);

    const observedTTFB = (await this.computeObservedMetric(data, context)).timing;
    const observedResponseTime =
      networkAnalysis.serverResponseTimeByOrigin.get(mainResource.parsedURL.securityOrigin);
    if (observedResponseTime === undefined) throw new Error('No response time for origin');

    // Estimate when the connection is not warm.
    // TTFB = DNS + (SSL)? + TCP handshake + 1 RT for request + server response time
    let roundTrips = 2;
    if (!mainResource.protocol.startsWith('h3')) roundTrips += 1; // TCP
    if (mainResource.parsedURL.scheme === 'https') roundTrips += 1;
    const estimatedTTFB = data.settings.throttling.rttMs * roundTrips + observedResponseTime;

    const timing = Math.max(observedTTFB, estimatedTTFB);
    return {timing};
  }

  /**
   * @param {LH.Artifacts.NavigationMetricComputationData} data
   * @param {LH.Artifacts.ComputedContext} context
   * @return {Promise<LH.Artifacts.Metric>}
   */
  static async computeObservedMetric(data, context) {
    const {processedNavigation} = data;
    const timeOriginTs = processedNavigation.timestamps.timeOrigin;
    const mainResource = await MainResource.request(data, context);

    // Technically TTFB is the start of the response headers not the end.
    // That signal isn't available to us so we use header end time as a best guess.
    const timestamp = mainResource.responseHeadersEndTime * 1000;
    const timing = (timestamp - timeOriginTs) / 1000;

    return {timing, timestamp};
  }
}

const TimeToFirstByteComputed = makeComputedArtifact(
  TimeToFirstByte,
  ['devtoolsLog', 'gatherContext', 'settings', 'simulator', 'trace', 'URL']
);
export {TimeToFirstByteComputed as TimeToFirstByte};
