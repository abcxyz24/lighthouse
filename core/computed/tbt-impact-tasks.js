/**
 * @license Copyright 2023 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import {makeComputedArtifact} from './computed-artifact.js';
import {MainThreadTasks} from './main-thread-tasks.js';
import {FirstContentfulPaint} from './metrics/first-contentful-paint.js';
import {Interactive} from './metrics/interactive.js';
import {TotalBlockingTime} from './metrics/total-blocking-time.js';
import {ProcessedTrace} from './processed-trace.js';
import {calculateTbtImpactForEvent} from './metrics/tbt-utils.js';

/** @typedef {LH.Artifacts.TaskNode & {tbtImpact: number, selfTbtImpact: number}} TBTImpactTask */

class TBTImpactTasks {
  /**
   * @param {LH.Artifacts.MetricComputationDataInput} metricComputationData
   * @param {LH.Artifacts.ComputedContext} context
   * @return {Promise<{startTimeMs: number, endTimeMs: number}>}
   */
  static async getTBTBounds(metricComputationData, context) {
    const processedTrace = await ProcessedTrace.request(metricComputationData.trace, context);
    if (metricComputationData.gatherContext.gatherMode !== 'navigation') {
      return {
        startTimeMs: 0,
        endTimeMs: processedTrace.timings.traceEnd,
      };
    }

    const fcpResult = await FirstContentfulPaint.request(metricComputationData, context);
    const ttiResult = await Interactive.request(metricComputationData, context);

    let startTimeMs = fcpResult.timing;
    let endTimeMs = ttiResult.timing;

    // When using lantern, we want to get a pessimistic view of the long tasks.
    // This means we assume the earliest possible start time and latest possible end time.

    if ('optimisticEstimate' in fcpResult) {
      startTimeMs = fcpResult.optimisticEstimate.timeInMs;
    }

    if ('pessimisticEstimate' in ttiResult) {
      endTimeMs = ttiResult.pessimisticEstimate.timeInMs;
    }

    return {startTimeMs, endTimeMs};
  }

  /**
   * @param {LH.Artifacts.MetricComputationDataInput} metricComputationData
   * @param {LH.Artifacts.ComputedContext} context
   * @return {Promise<TBTImpactTask[]>}
   */
  static async compute_(metricComputationData, context) {
    const tbtResult = await TotalBlockingTime.request(metricComputationData, context);
    const tasks = await MainThreadTasks.request(metricComputationData.trace, context);

    /** @type {Map<LH.Artifacts.TaskNode, number>} */
    const taskToImpact = new Map();

    const {startTimeMs, endTimeMs} = await this.getTBTBounds(metricComputationData, context);

    if ('pessimisticEstimate' in tbtResult) {
      /** @type {Map<LH.Artifacts.TaskNode, {start: number, end: number, duration: number}>} */
      const taskToEvent = new Map();

      /** @type {Map<LH.TraceEvent, LH.Artifacts.TaskNode>} */
      const traceEventToTask = new Map();
      for (const task of tasks) {
        traceEventToTask.set(task.event, task);
      }

      // Use lantern TBT timings to calculate the TBT impact of toplevel tasks.
      for (const [node, timing] of tbtResult.pessimisticEstimate.nodeTimings) {
        if (node.type !== 'cpu') continue;

        const event = {
          start: timing.startTime,
          end: timing.endTime,
          duration: timing.duration,
        };

        const tbtImpact = calculateTbtImpactForEvent(event, startTimeMs, endTimeMs);

        const task = traceEventToTask.get(node.event);
        if (!task) continue;

        taskToImpact.set(task, tbtImpact);
        taskToEvent.set(task, event);
      }

      // Interpolate the TBT impact of remaining tasks using their toplevel task.
      for (const task of tasks) {
        if (taskToImpact.has(task)) continue;

        let toplevelTask = task;
        while (toplevelTask.parent) {
          toplevelTask = toplevelTask.parent;
        }

        const toplevelEvent = taskToEvent.get(toplevelTask);
        if (!toplevelEvent) continue;

        const startRatio = (task.startTime - toplevelTask.startTime) / toplevelTask.duration;
        const start = startRatio * toplevelEvent.duration + toplevelEvent.start;

        const endRatio = (toplevelTask.endTime - task.endTime) / toplevelTask.duration;
        const end = toplevelEvent.end - endRatio * toplevelEvent.duration;

        const event = {
          start,
          end,
          duration: end - start,
        };

        const tbtImpact = calculateTbtImpactForEvent(event, startTimeMs, endTimeMs);

        taskToImpact.set(task, tbtImpact);
        taskToEvent.set(task, event);
      }
    } else {
      for (const task of tasks) {
        const event = {
          start: task.startTime,
          end: task.endTime,
          duration: task.duration,
        };

        const tbtImpact = calculateTbtImpactForEvent(event, startTimeMs, endTimeMs);

        taskToImpact.set(task, tbtImpact);
      }
    }

    /** @type {TBTImpactTask[]} */
    const tbtImpactTasks = [];
    for (const task of tasks) {
      const tbtImpact = taskToImpact.get(task) || 0;
      let selfTbtImpact = tbtImpact;

      for (const child of task.children) {
        const childTbtImpact = taskToImpact.get(child) || 0;
        selfTbtImpact -= childTbtImpact;
      }

      tbtImpactTasks.push({
        ...task,
        tbtImpact,
        selfTbtImpact,
      });
    }
    return tbtImpactTasks;
  }
}

const TBTImpactTasksComputed = makeComputedArtifact(TBTImpactTasks, null);
export {TBTImpactTasksComputed as TBTImpactTasks};
