/*
 * (C) Copyright 2017 o2r project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */
var mongoose = require('mongoose');
var timestamps = require('mongoose-timestamp');

var Compendium = new mongoose.Schema({
  id: String,
  user: String,
  journal: String,
  metadata: Object,
  created: {type: Date, default: Date.now},
  jobs: [String],
  candidate: {type: Boolean, default: true},
  bag: {type: Boolean, default: false},
  compendium: {type: Boolean, default: false},
  substituted: {type: Boolean, default: false}
});
Compendium.plugin(timestamps);

module.exports = mongoose.model('Compendium', Compendium);
