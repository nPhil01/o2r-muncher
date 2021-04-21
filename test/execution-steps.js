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

/* eslint-env mocha */
const assert = require('chai').assert;
const request = require('request');
const config = require('../config/config');
const createCompendiumPostRequest = require('./util').createCompendiumPostRequest;
const publishCandidate = require('./util').publishCandidate;
const waitForJob = require('./util').waitForJob;
const startJob = require('./util').startJob;
const mongojs = require('mongojs');
const fs = require('fs');
const fse = require('fs-extra');
const unameCall = require('node-uname');
const path = require('path');
const sleep = require('sleep');
const debug = require('debug')('test:job-steps');

require("./setup");
const cookie_o2r = 's:C0LIrsxGtHOGHld8Nv2jedjL4evGgEHo.GMsWD5Vveq0vBt7/4rGeoH5Xx7Dd2pgZR9DvhKCyDTY';
const cookie_plain = 's:yleQfdYnkh-sbj9Ez--_TWHVhXeXNEgq.qRmINNdkRuJ+iHGg5woRa9ydziuJ+DzFG9GnAZRvaaM';

let Docker = require('dockerode');
let docker = new Docker();

describe('API job steps', () => {
  var db = mongojs('localhost/muncher', ['compendia', 'jobs']);

  before(function (done) {
    db.jobs.drop(function (err, doc) {
      done();
    });
  });

  after(function (done) {
    db.close();
    done();
  });

  beforeEach('take a short break (1s)', function () {
    sleep.sleep(1);
  });

  describe('GET /api/v1/job (with no job started)', () => {
    it('should not yet contain array of job ids, but an empty list as valid JSON and HTTP 200', (done) => {
      request(global.test_host + '/api/v1/job', (err, res, body) => {
        assert.ifError(err);
        assert.equal(res.statusCode, 200);
        assert.isObject(JSON.parse(body), 'returned JSON');
        let response = JSON.parse(body);
        assert.property(response, 'results');
        assert.notProperty(response, 'error');
        assert.isArray(response.results);
        assert.isEmpty(response.results);
        done();
      });
    });
  });

  describe('GET /api/v1/job with compendium_id query for non-existing compendium', () => {
    it('should respond with HTTP 404 and and a helpful error message in JSON', (done) => {
      request(global.test_host + '/api/v1/job?compendium_id=1234', (err, res, body) => {
        assert.ifError(err);
        assert.equal(res.statusCode, 404);
        assert.isObject(JSON.parse(body), 'returned JSON');
        let response = JSON.parse(body);
        assert.notProperty(response, 'results');
        assert.property(response, 'error');
        done();
      });
    });
  });

  describe('EXECUTION of unknown compendium', () => {
    it('should return HTTP error and valid JSON with error message', (done) => {
      let j = request.jar();
      let ck = request.cookie('connect.sid=' + cookie_plain);
      j.setCookie(ck, global.test_host);

      request({
        uri: global.test_host + '/api/v1/job',
        method: 'POST',
        jar: j,
        formData: {
          compendium_id: '54321'
        },
        timeout: 1000
      }, (err, res, body) => {
        assert.ifError(err);
        assert.equal(res.statusCode, 400);
        let response = JSON.parse(body);
        assert.notProperty(response, 'job_id');
        assert.property(response, 'error');
        done();
      });
    });
  });

  describe('EXECUTION of multiple jobs', () => {
    let job_id0, job_id1, job_id2 = '';

    before(function (done) {
      this.timeout(90000);

      db.compendia.drop(function (err, doc) {
        createCompendiumPostRequest('./test/erc/step_validate_compendium', cookie_o2r, 'compendium', (req) => {
          request(req, (err, res, body) => {
            compendium_id = JSON.parse(body).id;
            publishCandidate(compendium_id, cookie_o2r, () => {
              startJob(compendium_id, id => {
                job_id0 = id;
                done();
              });
            });
          });
        });
      });
    });

    it('should return job ID when starting _another_ job execution (different from the previous id)', (done) => {
      let j = request.jar();
      let ck = request.cookie('connect.sid=' + cookie_plain);
      j.setCookie(ck, global.test_host);

      request({
        uri: global.test_host + '/api/v1/job',
        method: 'POST',
        jar: j,
        formData: {
          compendium_id: compendium_id
        },
        timeout: 1000
      }, (err, res, body) => {
        assert.ifError(err);
        assert.equal(res.statusCode, 200);
        let response = JSON.parse(body);
        assert.property(response, 'job_id');
        assert.notEqual(response.job_id, job_id0);
        job_id1 = response.job_id;
        done();
      });
    });

    it('should return job ID when starting _yet another_ job execution (different from the previous ids)', (done) => {
      let j = request.jar();
      let ck = request.cookie('connect.sid=' + cookie_plain);
      j.setCookie(ck, global.test_host);

      request({
        uri: global.test_host + '/api/v1/job',
        method: 'POST',
        jar: j,
        formData: {
          compendium_id: compendium_id
        },
        timeout: 1000
      }, (err, res, body) => {
        assert.ifError(err);
        assert.equal(res.statusCode, 200);
        let response = JSON.parse(body);
        assert.property(response, 'job_id');
        assert.notEqual(response.job_id, job_id0);
        assert.notEqual(response.job_id, job_id1);
        job_id2 = response.job_id;
        done();
      });
    });
  });

  describe('EXECUTION of candidate compendium', () => {
    let compendium_id = '';

    before(function (done) {
      this.timeout(90000);
      db.compendia.drop(function (err, doc) {
        createCompendiumPostRequest('./test/workspace/dummy', cookie_o2r, 'workspace', (req) => {
          request(req, (err, res, body) => {
            compendium_id = JSON.parse(body).id;
            done();
          });
        });
      });
    });

    it('should return HTTP error code and error message as valid JSON when starting job as non-logged-in user', (done) => {
      request({
        uri: global.test_host + '/api/v1/job',
        method: 'POST',
        formData: {
          compendium_id: compendium_id
        },
        timeout: 1000
      }, (err, res, body) => {
        assert.ifError(err);
        response = JSON.parse(body);
        assert.equal(res.statusCode, 401);
        assert.isObject(JSON.parse(body));
        assert.notProperty(response, 'job_id');
        assert.property(response, 'error');
        done();
      });
    });

    it('should return HTTP error code and error message as valid JSON when starting job as logged-in user', (done) => {
      let j = request.jar();
      let ck = request.cookie('connect.sid=' + cookie_plain);
      j.setCookie(ck, global.test_host);

      request({
        uri: global.test_host + '/api/v1/job',
        method: 'POST',
        jar: j,
        formData: {
          compendium_id: compendium_id
        },
        timeout: 1000
      }, (err, res, body) => {
        assert.ifError(err);
        response = JSON.parse(body);
        assert.equal(res.statusCode, 403);
        assert.isObject(JSON.parse(body));
        assert.notProperty(response, 'job_id');
        assert.property(response, 'error');
        done();
      });
    });

    it('should return HTTP 200 and start a job when author', (done) => {
      let j = request.jar();
      let ck = request.cookie('connect.sid=' + cookie_o2r);
      j.setCookie(ck, global.test_host);

      request({
        uri: global.test_host + '/api/v1/job',
        method: 'POST',
        jar: j,
        formData: {
          compendium_id: compendium_id
        },
        timeout: 1000
      }, (err, res, body) => {
        assert.ifError(err);
        response = JSON.parse(body);
        assert.equal(res.statusCode, 200);
        assert.isObject(JSON.parse(body));
        assert.property(response, 'job_id');
        assert.notProperty(response, 'error');
        done();
      });
    });
  });

  describe('EXECUTION step_validate_bag', () => {
    let job_id = '';

    before(function (done) {
      this.timeout(90000);
      db.compendia.drop(function (err, doc) {
        createCompendiumPostRequest('./test/erc/step_validate_bag', cookie_o2r, 'compendium', (req) => {
          request(req, (err, res, body) => {
            compendium_id = JSON.parse(body).id;
            publishCandidate(compendium_id, cookie_o2r, () => {
              startJob(compendium_id, id => {
                job_id = id;
                waitForJob(job_id, (finalStatus) => {
                  done();
                });
              });
            }, true);
          });
        });
      });
    });

    it('should skip step "validate_bag"', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response.steps.validate_bag, 'status', 'skipped');
        done();
      });
    });

    it('should fail step "validate_compendium"', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response.steps.validate_compendium, 'status', 'failure');
        done();
      });
    });

    it('should skip configuration generation steps', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response.steps.generate_configuration, 'status', 'skipped', 'generate configuration should be skipped');
        done();
      });
    });

    it('should have remaining steps "queued"', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response.steps.generate_manifest, 'status', 'queued', 'generate manifest should be queued');
        assert.propertyVal(response.steps.image_prepare, 'status', 'queued', 'image prepare should be queued');
        assert.propertyVal(response.steps.image_build, 'status', 'queued', 'image build should be queued');
        assert.propertyVal(response.steps.image_execute, 'status', 'queued', 'image execute should be queued');
        assert.propertyVal(response.steps.check, 'status', 'queued', 'check should be queued');
        done();
      });
    });

    it('should complete step "cleanup"', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response.steps.cleanup, 'status', 'success');
        done();
      });
    });

    it('should have overall status "failure"', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response, 'status', 'failure');
        done();
      });
    });
  });

  describe('EXECUTION step_validate_compendium', () => {
    let job_id = '';

    before(function (done) {
      this.timeout(90000);
      db.compendia.drop(function (err, doc) {
        createCompendiumPostRequest('./test/erc/step_validate_compendium', cookie_o2r, 'compendium', (req) => {
          request(req, (err, res, body) => {
            compendium_id = JSON.parse(body).id;
            publishCandidate(compendium_id, cookie_o2r, () => {
              startJob(compendium_id, id => {
                job_id = id;
                waitForJob(job_id, (finalStatus) => {
                  done();
                });
              });
            });
          });
        });
      });
    });

    it('should complete step "validate_compendium"', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response.steps.validate_compendium, 'status', 'success');
        done();
      });
    });

    it('should skip steps "validate_bag" and "generate_configuration"', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response.steps.validate_bag, 'status', 'skipped');
        assert.propertyVal(response.steps.generate_configuration, 'status', 'skipped');
        done();
      });
    });

    it('should have steps "image_prepare", "image_build", "image_execute", and "check" queued', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response.steps.image_prepare, 'status', 'queued', 'image prepare is queued');
        assert.propertyVal(response.steps.image_build, 'status', 'queued', 'image build is queued');
        assert.propertyVal(response.steps.image_execute, 'status', 'queued', 'image execute is queued');
        assert.propertyVal(response.steps.check, 'status', 'queued', 'check is queued');
        done();
      });
    });

    it('should fail step "generate_manifest"', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response.steps.generate_manifest, 'status', 'failure');
        done();
      });
    });

    it('should fail overall', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response, 'status', 'failure');
        done();
      });
    });
  });

  describe('GET /api/v1/job with multiple jobs overall', () => {

    it('should contain fewer results if start is provided', (done) => {
      request(global.test_host + '/api/v1/job', (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        let all_count = response.results.length;
        let start = 3;

        request(global.test_host + '/api/v1/job?start=' + start, (err2, res2, body2) => {
          assert.ifError(err2);
          let response2 = JSON.parse(body2);
          assert.equal(response2.results.length, all_count - start + 1);
          done();
        });
      });
    });

    it('should contain no results but an empty list (valid JSON, HTTP 200) if too large start parameter is provided', (done) => {
      request(global.test_host + '/api/v1/job?start=999', (err, res, body) => {
        assert.ifError(err);
        assert.equal(res.statusCode, 200);
        assert.isObject(JSON.parse(body), 'returned JSON');
        let response = JSON.parse(body);
        assert.property(response, 'results');
        assert.notProperty(response, 'error');
        assert.isArray(response.results);
        assert.isEmpty(response.results);
        done();
      });
    });

    it('should just list the number of jobs requested', (done) => {
      request(global.test_host + '/api/v1/job?limit=2', (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.isArray(response.results);
        assert.equal(response.results.length, 2);
        done();
      });
    });
  });

  describe('EXECUTION configuration file generation', () => {

  before(function(done) {
    db.compendia.drop(function (err, doc) {
      done();
    });
  });
  
    it('should skip steps validate bag and generate configuration, but complete following steps', (done) => {
      createCompendiumPostRequest('./test/workspace/rmd-configuration-file', cookie_o2r, 'workspace', (req) => {
        request(req, (err, res, body) => {
          assert.ifError(err);
          let compendium_id = JSON.parse(body).id;

          publishCandidate(compendium_id, cookie_o2r, () => {
            startJob(compendium_id, id => {
              let job_id = id;

              waitForJob(job_id, (finalStatus) => {
                request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
                  assert.ifError(err);
                  let response = JSON.parse(body);

                  assert.propertyVal(response.steps.validate_bag, 'status', 'skipped', 'skip validate bag');
                  assert.propertyVal(response.steps.generate_configuration, 'status', 'skipped', 'skip generate configuration because there is one');
                  assert.propertyVal(response.steps.validate_compendium, 'status', 'success', 'succeed validate compendium');
                  assert.propertyVal(response.steps.image_prepare, 'status', 'success', 'succeed image prepare');
                  assert.propertyVal(response.steps.image_build, 'status', 'success', 'succeed image build');
                  assert.propertyVal(response.steps.image_execute, 'status', 'success', 'succeed image execute');
                  assert.propertyVal(response.steps.cleanup, 'status', 'success', 'succeed cleanup');

                  done();
                });
              });
            });
          });
        });
      });
    }).timeout(720000);

    it('should complete step "generate_configuration" and skip previous steps for minimal-rmd-data', (done) => {
      createCompendiumPostRequest('./test/workspace/rmd-data', cookie_o2r, 'workspace', (req) => {
        request(req, (err, res, body) => {
          assert.ifError(err);
          let compendium_id = JSON.parse(body).id;

          publishCandidate(compendium_id, cookie_o2r, () => {
            startJob(compendium_id, id => {
              let job_id = id;

              waitForJob(job_id, (finalStatus) => {
                request(global.test_host + '/api/v1/job/' + job_id + '?steps=all', (err, res, body) => {
                  assert.ifError(err);
                  let response = JSON.parse(body);

                  assert.propertyVal(response.steps.validate_bag, 'status', 'skipped', 'skip validate bag');
                  assert.propertyVal(response.steps.validate_compendium, 'status', 'success', 'succeed validate compendium');
                  assert.propertyVal(response.steps.generate_configuration, 'status', 'success', 'succeed generate configuration');
                  assert.propertyVal(response.steps.check, 'status', 'failure', 'fail check');
                  assert.isBelow(response.steps.check.images[0].compareResults.differences, 3200, 'fail check because of slight differences in image');

                  done();
                });
              });
            });
          });
        });
      });
    }).timeout(720000);
  });

  describe('EXECUTION step_image_prepare', () => {
    let job_id = '';

    before(function (done) {
      this.timeout(90000);
      createCompendiumPostRequest('./test/erc/step_image_prepare', cookie_o2r, 'compendium', (req) => {
        request(req, (err, res, body) => {
          let compendium_id = JSON.parse(body).id;
          publishCandidate(compendium_id, cookie_o2r, () => {
            startJob(compendium_id, id => {
              job_id = id;
              waitForJob(job_id, (finalStatus) => {
                done();
              });
            });
          });
        });
      });
    });

    it('should complete step "image_prepare"', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response.steps.image_prepare, 'status', 'success');
        done();
      });
    });

    it('should fail step "image_build"', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response.steps.image_build, 'status', 'failure');
        done();
      });
    });

    it('should list other image_execute as queued', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response.steps.image_execute, 'status', 'queued');
        done();
      });
    });

    it('should complete step "cleanup"', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response.steps.cleanup, 'status', 'success');
        done();
      });
    });

    it('should have deleted payload file during cleanup', (done) => {
      let tarballFileName = path.join(config.payload.tarball.tmpdir, job_id + '.tar');
      try {
        fs.lstatSync(tarballFileName);
        assert.fail();
      } catch (error) {
        assert.include(error.message, 'no such file or directory');
        done();
      }
    });
  });

  describe('EXECUTION step_image_build', () => {
    let compendium_id, job_id = null;

    before(function (done) {
      this.timeout(90000);
      createCompendiumPostRequest('./test/erc/step_image_build', cookie_o2r, 'compendium', (req) => {
        request(req, (err, res, body) => {
          compendium_id = JSON.parse(body).id;
          publishCandidate(compendium_id, cookie_o2r, () => {
            startJob(compendium_id, id => {
              job_id = id;
              waitForJob(job_id, (finalStatus) => {
                done();
              });
            });
          });
        });
      });
    });

    it('should complete all previous steps', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.propertyVal(response.steps.validate_bag, 'status', 'skipped', 'bag validation should fail with "skipped" because of added metadata files');
        assert.propertyVal(response.steps.validate_compendium, 'status', 'success');
        assert.propertyVal(response.steps.image_prepare, 'status', 'success');
        done();
      });
    });

    it('should skip steps "generate_configuration" and "generate_manifest"', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response.steps.generate_configuration, 'status', 'skipped');
        assert.propertyVal(response.steps.generate_manifest, 'status', 'skipped');
        done();
      });
    });

    it('should complete step "image_build"', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response.steps.image_build, 'status', 'success');
        done();
      });
    });

    it('should have an image hash in the step metadata, which must be sha256', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id + '?steps=all', (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.property(response.steps.image_build, 'imageId');
        assert.match(response.steps.image_build.imageId, /^sha256:[a-z0-9]+$/g);
        done();
      });
    });

    it('should fail step "image_execute" with a status code "1"', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id + '?steps=all', (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response.steps.image_execute, 'status', 'failure');
        assert.propertyVal(response.steps.image_execute, 'statuscode', 1);
        done();
      });
    });

    it('should complete step "cleanup"', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response.steps.cleanup, 'status', 'success');
        done();
      });
    });

    it('should have tagged an image for the job (skipped if images are not kept)', function (done) {
      if (config.bagtainer.keepImages) {
        docker.listImages(function (err, images) {
          assert.ifError(err);

          let names = new Set();
          images.forEach(function (image) {
            if (image.RepoTags) {
              image.RepoTags.forEach(function (tag) {
                names.add(tag);
              });
            }
          });

          assert.include(names, config.bagtainer.image.prefix.job + job_id);
          done();
        });
      } else {
        this.skip();
      }
    }).timeout(60000);

    it('should not have tagged an image for the compendium (skipped if images are not kept)', function (done) {
      if (config.bagtainer.keepImages) {
        docker.listImages(function (err, images) {
          assert.ifError(err);

          let names = new Set();
          images.forEach(function (image) {
            if (image.RepoTags) {
              image.RepoTags.forEach(function (tag) {
                names.add(tag);
              });
            }
          });

          assert.notInclude(names, config.bagtainer.image.prefix.job + compendium_id);
          done();
        });
      } else {
        this.skip();
      }
    }).timeout(60000);
  });

  describe('EXECUTION step_image_execute', () => {
    let job_id = '';

    before(function (done) {
      this.timeout(90000);
      createCompendiumPostRequest('./test/erc/step_image_execute', cookie_o2r, 'compendium', (req) => {
        request(req, (err, res, body) => {
          let compendium_id = JSON.parse(body).id;
          publishCandidate(compendium_id, cookie_o2r, () => {
            startJob(compendium_id, id => {
              job_id = id;
              waitForJob(job_id, (finalStatus) => {
                done();
              });
            });
          });
        });
      });
    });

    it('should complete step all previous steps (and skip bag validation)', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.propertyVal(response.steps.validate_bag, 'status', 'skipped');
        assert.propertyVal(response.steps.validate_compendium, 'status', 'success');
        assert.propertyVal(response.steps.image_prepare, 'status', 'success');
        assert.propertyVal(response.steps.image_build, 'status', 'success');
        done();
      });
    });

    it('should complete step "image_execute"', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response.steps.image_execute, 'status', 'success');
        done();
      });
    });

    it('should not have the display file in the file listing for the job (execute completes but does not generate a file)', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.notInclude(JSON.stringify(response.files), 'doc.html');
        assert.notInclude(JSON.stringify(response.files), 'wrongname.html');
        done();
      });
    });

    it('should fail step "check" and have empty images and display properties (depends on https://github.com/o2r-project/erc-checker/issues/8)', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id + '?steps=all', (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response.steps.check, 'status', 'failure');
        assert.propertyVal(response.steps.check, 'checkSuccessful', false);
        assert.property(response.steps.check, 'display');
        assert.isNotNull(response.steps.check.display);
        assert.property(response.steps.check, 'images');
        assert.isArray(response.steps.check.images);
        assert.isEmpty(response.steps.check.images);
        done();
      });
    });

    it('should have a diff HTML but no images (depends on https://github.com/o2r-project/erc-checker/issues/8)', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id + '?steps=all', (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.property(response.steps.check, 'display');
        assert.property(response.steps.check, 'images');
        assert.isArray(response.steps.check.images);
        assert.isEmpty(response.steps.check.images);
        done();
      });
    });

    it('should have a non-empty errors array', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id + '?steps=all', (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.property(response.steps.check, 'errors');
        assert.isArray(response.steps.check.errors);
        assert.isNotEmpty(response.steps.check.errors);
        assert.include(JSON.stringify(response.steps.check.errors), 'no such file');
        done();
      });
    });

    it('should have step "image_save" queued (failure in previous step)', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response.steps.image_save, 'status', 'queued');
        done();
      });
    });

    it('should complete step "cleanup"', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response.steps.cleanup, 'status', 'success');
        done();
      });
    });

    it.skip('execution log should include uname output', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id + '?steps=all', (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.property(response.steps.image_execute, 'text');

        let uname = unameCall();
        log = JSON.stringify(response.steps.image_execute.text);
        assert.include(log, uname.machine);
        assert.include(log, uname.release);
        assert.include(log, uname.sysname);
        assert.include(log, uname.version);
        done();
      });
    });

    it('should have deleted container during cleanup (skipped if containers are kept)', function (done) {
      if (!config.bagtainer.keepContainers) {
        docker.listContainers({ all: true }, function (err, containers) {
          containers.forEach(function (containerInfo) {
            assert.notEqual(containerInfo.Image, config.bagtainer.image.prefix.job + job_id);
          });

          done();
        });
      } else {
        this.skip();
      }
    });

    it('should have deleted image during cleanup (skipped if images are kept)', function (done) {
      if (!config.bagtainer.keepImages) {
        docker.listImages(function (err, images) {
          assert.ifError(err);

          images.forEach(function (image) {
            let tags = image.RepoTags;
            tags.forEach(function (tag) {
              assert.notEqual(tag, config.bagtainer.image.prefix.job + job_id);
            });
          });

          done();
        });
      } else {
        this.skip();
      }
    });

    it('should have deleted payload file during cleanup', (done) => {
      let tarballFileName = path.join(config.payload.tarball.tmpdir, job_id + '.tar');
      try {
        fs.lstatSync(tarballFileName);
        assert.fail();
      } catch (error) {
        assert.include(error.message, 'no such file or directory');
        done();
      }
    });
  });

  describe('EXECUTION step_check', () => {
    let job_id, compendium_id, job_id2 = '';

    before(function (done) {
      this.timeout(360000); // takes quite long because of image saving and deleting compendium + image

      db.compendia.drop(function (err, doc) {
        fse.removeSync(path.join(config.fs.compendium, 'KIbebWnPlx-check'));

        docker.getImage('erc:KIbebWnPlx-check').remove(function (err, data) {
          if (err) debug('Error removing image: %o', err);
          else debug('%o', data);

          createCompendiumPostRequest('./test/erc/step_check', cookie_o2r, 'compendium', (req) => {
            request(req, (err, res, body) => {
              compendium_id = JSON.parse(body).id;
              publishCandidate(compendium_id, cookie_o2r, () => {
                startJob(compendium_id, id => {
                  job_id = id;
                  waitForJob(job_id, (finalStatus) => {
                    startJob(compendium_id, id => {
                      job_id2 = id;
                      waitForJob(job_id2, (finalStatus) => {
                        done();
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });

    it('should complete specific steps', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.propertyVal(response.steps.validate_compendium, 'status', 'success', 'validate compendium');
        assert.propertyVal(response.steps.generate_manifest, 'status', 'success', 'generate manifest');
        assert.propertyVal(response.steps.image_prepare, 'status', 'success', 'image prepare');
        assert.propertyVal(response.steps.image_build, 'status', 'success', 'image build');
        assert.propertyVal(response.steps.image_execute, 'status', 'success', 'image execute');
        assert.propertyVal(response.steps.image_save, 'status', 'success', 'image save');
        assert.propertyVal(response.steps.cleanup, 'status', 'success', 'cleanup');
        done();
      });
    });

    it('should skip specific steps', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.propertyVal(response.steps.validate_bag, 'status', 'skipped', 'validate bag');
        assert.propertyVal(response.steps.generate_configuration, 'status', 'skipped', 'generate configuration');
        done();
      });
    });

    it('should complete step "check" but not have a display diff nor images', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id + '?steps=all', (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.propertyVal(response.steps.check, 'status', 'success');
        assert.propertyVal(response.steps.check, 'checkSuccessful', true);
        assert.property(response.steps.check, 'display');
        assert.isNotNull(response.steps.check.display);
        assert.property(response.steps.check, 'images');
        assert.isArray(response.steps.check.images);
        assert.isEmpty(response.steps.check.images);
        done();
      });
    });

    it('should have a reference to the image file in step image_save', function (done) {
      request(global.test_host + '/api/v1/job/' + job_id + '?steps=all', (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.property(response.steps.image_save, 'file');
        assert.propertyVal(response.steps.image_save, 'file', path.join(config.bagit.payloadDirectory, config.bagtainer.imageTarballFile));
        assert.notPropertyVal(response.steps.image_save, 'file', config.bagtainer.imageTarballFile);
        done();
      });
    });

    it('should have a text log for image_save', function (done) {
      request(global.test_host + '/api/v1/job/' + job_id + '?steps=all', (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.property(response.steps.image_save, 'text');
        assert.include(JSON.stringify(response.steps.image_save.text), 'Saved image tarball');
        done();
      });
    });

    it('should list the image tarball in the compendium file listing', function (done) {
      request(global.test_host + '/api/v1/compendium/' + compendium_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.include(JSON.stringify(response.files), 'image.tar');
        done();
      });
    });

    it('should not have the image tarball in the job file listing', function (done) {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.notInclude(JSON.stringify(response.files), 'image.tar');
        done();
      });
    });

    it('should have tagged an image for both the compendium and the job (skipped if images are not kept)', function (done) {
      if (config.bagtainer.keepImages) {
        docker.listImages(function (err, images) {
          assert.ifError(err);

          let names = new Set();
          images.forEach(function (image) {
            if (image.RepoTags) {
              image.RepoTags.forEach(function (tag) {
                names.add(tag);
              });
            }
          });

          assert.include(names, config.bagtainer.image.prefix.compendium + compendium_id);
          assert.include(names, config.bagtainer.image.prefix.job + job_id);
          done();
        });
      } else {
        this.skip();
      }
    }).timeout(60000);

    it('should mention the missing tarball in the image_build logs', function (done) {
      request(global.test_host + '/api/v1/job/' + job_id + '?steps=image_build', (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.include(JSON.stringify(response.steps.image_build.text), 'No image tarball found');
        done();
      });
    });

    it('should skip further steps for the 2nd job', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id2, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.propertyVal(response.steps.validate_bag, 'status', 'skipped', 'validate bag');
        assert.propertyVal(response.steps.generate_configuration, 'status', 'skipped', 'generate configuration');
        assert.propertyVal(response.steps.generate_manifest, 'status', 'skipped', 'generate manifest');
        assert.propertyVal(response.steps.image_save, 'status', 'skipped', 'image save');
        done();
      });
    });

    it('should not overwrite the image tarball when running a second job', function (done) {
      request(global.test_host + '/api/v1/job/' + job_id2 + '?steps=image_save', (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.include(JSON.stringify(response.steps.image_save.text), 'image digests match');
        done();
      });
    });

    it('should mention tagging the existing compendium image for the second job', function (done) {
      request(global.test_host + '/api/v1/job/' + job_id2 + '?steps=image_build', (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.include(JSON.stringify(response.steps.image_build.text), 'Tagged image erc:' + compendium_id + ' with job:' + job_id2);
        done();
      });
    });

    it('should mention not overwriting the image tarball in the second job', function (done) {
      request(global.test_host + '/api/v1/job/' + job_id2 + '?steps=image_save', (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);
        assert.include(JSON.stringify(response.steps.image_save.text), 'Image tarball file saving skipped');
        done();
      });
    });

  });

  describe('EXECUTION check with random result in figure', () => {
    let job_id = '';
    let compendium_id = '';

    before(function (done) {
      this.timeout(720000);
      createCompendiumPostRequest('./test/workspace/rmd-data-random', cookie_o2r, 'workspace', (req) => {
        request(req, (err, res, body) => {
          compendium_id = JSON.parse(body).id;
          publishCandidate(compendium_id, cookie_o2r, () => {
            startJob(compendium_id, id => {
              job_id = id;
              waitForJob(job_id, (finalStatus) => {
                done();
              });
            });
          });
        });
      });
    });

    it('should skip validate bag step', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.propertyVal(response.steps.validate_bag, 'status', 'skipped');
        done();
      });
    });

    it('should have same start and end date for skipped step', (done) => {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.property(response.steps.validate_bag, 'start');
        assert.property(response.steps.validate_bag, 'end');
        assert.equal(response.steps.validate_bag.start, response.steps.validate_bag.end, 'skipped step validate bag has same date for start and end');
        done();
      });
    });

    it('should complete generate configuration, validate compendium, image build, image execute, and cleanup', function (done) {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.propertyVal(response.steps.generate_configuration, 'status', 'success');
        assert.propertyVal(response.steps.validate_compendium, 'status', 'success');
        assert.propertyVal(response.steps.image_build, 'status', 'success');
        assert.propertyVal(response.steps.image_execute, 'status', 'success');
        assert.propertyVal(response.steps.cleanup, 'status', 'success');
        done();
      });
    });

    it('should complete generate manifest and have the correct manifest file path in the step details', function (done) {
      request(global.test_host + '/api/v1/job/' + job_id + '?steps=all', (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.propertyVal(response.steps.generate_manifest, 'status', 'success');
        assert.property(response.steps.generate_manifest, 'manifest');
        assert.propertyVal(response.steps.generate_manifest, 'manifest', 'Dockerfile');
        assert.notInclude(response.steps.generate_manifest.manifest, config.fs.base);
        done();
      });
    });

    it('should fail the step check', function (done) {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.propertyVal(response.steps.check, 'status', 'failure');
        done();
      });
    });

    it('should have skipped the step image_save', function (done) {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.propertyVal(response.steps.image_save, 'status', 'skipped');
        done();
      });
    });

    it('should have empty errors array in the step check', function (done) {
      request(global.test_host + '/api/v1/job/' + job_id + '?steps=check', (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.property(response.steps.check, 'errors');
        assert.isArray(response.steps.check.errors)
        assert.isEmpty(response.steps.check.errors);
        done();
      });
    });

    it('should have a reference to a diff file step check', function (done) {
      request(global.test_host + '/api/v1/job/' + job_id + '?steps=check', (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.property(response.steps.check, 'display');
        assert.property(response.steps.check.display, 'diff');
        done();
      });
    });

    it.skip('should not have an HTML file in the files list named as the main document (output_file naming works)', function (done) {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.notInclude(JSON.stringify(response.files), 'main.html');
        done();
      });
    });
  });

  describe('EXECUTION check with random result in text', () => {
    let job_id = '';
    let compendium_id = '';

    before(function (done) {
      this.timeout(720000);
      createCompendiumPostRequest('./test/workspace/rmd-textdiff', cookie_o2r, 'workspace', (req) => {
        request(req, (err, res, body) => {
          compendium_id = JSON.parse(body).id;
          publishCandidate(compendium_id, cookie_o2r, () => {
            startJob(compendium_id, id => {
              job_id = id;
              waitForJob(job_id, (finalStatus) => {
                done();
              });
            });
          });
        });
      });
    });

    it('should complete generate configuration, validate compendium, generate manifest, image build, image execute, and cleanup', function (done) {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.propertyVal(response.steps.generate_configuration, 'status', 'success');
        assert.propertyVal(response.steps.validate_compendium, 'status', 'success');
        assert.propertyVal(response.steps.generate_manifest, 'status', 'success');
        assert.propertyVal(response.steps.image_build, 'status', 'success');
        assert.propertyVal(response.steps.image_execute, 'status', 'success');
        assert.propertyVal(response.steps.cleanup, 'status', 'success');
        done();
      });
    });

    it('should fail the step check', function (done) {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.propertyVal(response.steps.check, 'status', 'failure');
        done();
      });
    });

    it('should skip the step image_save', function (done) {
      request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.propertyVal(response.steps.image_save, 'status', 'skipped');
        done();
      });
    });

    it('should have empty errors array in the step check', function (done) {
      request(global.test_host + '/api/v1/job/' + job_id + '?steps=check', (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.property(response.steps.check, 'errors');
        assert.isArray(response.steps.check.errors)
        assert.isEmpty(response.steps.check.errors);
        done();
      });
    });

    it('should have a reference to a diff file in step check', function (done) {
      request(global.test_host + '/api/v1/job/' + job_id + '?steps=check', (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.property(response.steps.check, 'display');
        assert.property(response.steps.check.display, 'diff');
        assert.propertyVal(response.steps.check.display, 'diff', '/api/v1/job/' + job_id + '/data/' + config.checker.diffFileName);
        done();
      });
    });

    it('should list a number of text differences in step details', function (done) {
      request(global.test_host + '/api/v1/job/' + job_id + '?steps=check', (err, res, body) => {
        assert.ifError(err);
        let response = JSON.parse(body);

        assert.property(response.steps.check, 'numTextDifferrences');
        assert.isNumber(response.steps.check.numTextDifferrences);
        assert.isAtLeast(response.steps.check.numTextDifferrences, 8);
        done();
      });
    });
    
  });

  describe('API job step details filtering', () => {
    var job_id;

    before(function (done) {
      this.timeout(90000);
      db.compendia.drop(function (err, doc) {
        db.jobs.drop(function (err, doc) {
          createCompendiumPostRequest('./test/workspace/rmd-data', cookie_o2r, 'workspace', (req) => {
            request(req, (err, res, body) => {
              let compendium_id = JSON.parse(body).id;
              publishCandidate(compendium_id, cookie_o2r, () => {
                startJob(compendium_id, id => {
                  job_id = id;
                  waitForJob(job_id, (finalStatus) => {
                    done();
                  });
                });
              });
            });
          });
        });
      });
    });

    describe('GET /api/v1/job when "steps" is missing', () => {
      it('should return only status, start and end', (done) => {
        request(global.test_host + '/api/v1/job/' + job_id, (err, res, body) => {
          assert.ifError(err);
          assert.equal(res.statusCode, 200, 'status code OK');
          assert.isObject(JSON.parse(body), 'returned JSON');
          let response = JSON.parse(body);

          assert.property(response, 'steps');
          Object.entries(response.steps).forEach(([step, value], index, array) => {
            assert.property(value, 'status', step + ' has status');
            assert.property(value, 'start', step + ' has start');
            assert.property(value, 'end', step + ' has end');
            assert.notProperty(value, 'text', step + ' does not have text');
            assert.notProperty(value, 'statuscode', step + ' does not have statuscode');
            assert.notProperty(value, 'images', step + ' does not have images');
            assert.notProperty(value, 'manifest', step + ' does not have manifest');
          });

          done();
        });
      });
    });

    describe('GET /api/v1/job when "steps=all"', () => {
      it('should return all details', (done) => {
        request(global.test_host + '/api/v1/job/' + job_id + '?steps=all', (err, res, body) => {
          assert.ifError(err);
          assert.equal(res.statusCode, 200);
          assert.isObject(JSON.parse(body), 'returned JSON');
          let response = JSON.parse(body);

          assert.property(response, 'steps');
          Object.entries(response.steps).forEach(([step, value], index, array) => {
            assert.property(value, 'status', step + ' has status');
            assert.property(value, 'start', step + ' has start');
            assert.property(value, 'end'), step + ' has end';
            assert.property(value, 'text', step + ' has text');
          });

          assert.property(response.steps.generate_manifest, 'manifest');
          assert.property(response.steps.image_execute, 'statuscode');
          assert.property(response.steps.check, 'images');
          assert.property(response.steps.check, 'display');

          done();
        });
      });
    });

    describe('GET /api/v1/job for one selected step', () => {
      it('should give status, start and end but full details for the step', (done) => {
        request(global.test_host + '/api/v1/job/' + job_id + '?steps=generate_manifest', (err, res, body) => {
          assert.ifError(err);
          assert.equal(res.statusCode, 200);
          assert.isObject(JSON.parse(body), 'returned JSON');
          let response = JSON.parse(body);

          assert.property(response, 'steps');
          Object.entries(response.steps).forEach(([step, value], index, array) => {
            assert.property(value, 'status', step + ' has status');
            assert.property(value, 'start', step + ' has start');
            assert.property(value, 'end'), step + ' has end';
            if (step != 'generate_manifest') assert.notProperty(value, 'text', step + ' does not have text');
          });

          assert.property(response.steps.generate_manifest, 'manifest');
          assert.property(response.steps.generate_manifest, 'text');

          done();
        });
      });
    });

    describe('GET /api/v1/job with trailing slash and without', () => {
      it('should just work', (done) => {
        request(global.test_host + '/api/v1/job/' + job_id + '/?steps=validate_bag', (err, res, body) => {
          assert.ifError(err);
          assert.equal(res.statusCode, 200);
          assert.isObject(JSON.parse(body), 'returned JSON');
          let responseWith = JSON.parse(body);

          request(global.test_host + '/api/v1/job/' + job_id + '?steps=validate_bag', (err, res, body) => {
            assert.ifError(err);
            assert.equal(res.statusCode, 200);
            assert.isObject(JSON.parse(body), 'returned JSON');
            let responseWithout = JSON.parse(body);

            assert.property(responseWith.steps.validate_bag, 'status');
            assert.property(responseWithout.steps.validate_bag, 'status');
            assert.property(responseWith.steps.validate_bag, 'text');
            assert.property(responseWithout.steps.validate_bag, 'text');

            assert.notProperty(responseWith.steps.validate_compendium, 'text');
            assert.notProperty(responseWithout.steps.validate_compendium, 'text');

            done();
          });
        });
      });
    });

    describe('GET /api/v1/job with two selected steps', () => {
      it('should give status, start and end for all steps, but full details for two selected steps', (done) => {
        request(global.test_host + '/api/v1/job/' + job_id + '?steps=check,cleanup', (err, res, body) => {
          assert.ifError(err);
          assert.equal(res.statusCode, 200);
          assert.isObject(JSON.parse(body), 'returned JSON');
          let response = JSON.parse(body);

          assert.property(response, 'steps');
          Object.entries(response.steps).forEach(([step, value], index, array) => {
            assert.property(value, 'status', step + ' has status');
            assert.property(value, 'start', step + ' has start');
            assert.property(value, 'end'), step + ' has end';
            if (!['check', 'cleanup'].includes(step)) {
              assert.notProperty(value, 'text', step + ' does not have text');
            }
          });

          assert.property(response.steps.check, 'text');
          assert.property(response.steps.cleanup, 'text');
          assert.property(response.steps.check, 'images');

          done();
        });
      });
    });

    describe('GET /api/v1/job with two existing steps and one unknown', () => {
      it('should give status, start and end for all steps, but full details for two selected steps', (done) => {
        request(global.test_host + '/api/v1/job/' + job_id + '?steps=check,cleanup,oneGiantLeap', (err, res, body) => {
          assert.ifError(err);
          assert.equal(res.statusCode, 200);
          assert.isObject(JSON.parse(body), 'returned JSON');
          let response = JSON.parse(body);

          assert.property(response, 'steps');
          Object.entries(response.steps).forEach(([step, value], index, array) => {
            assert.property(value, 'status', step + ' has status');
            assert.property(value, 'start', step + ' has start');
            assert.property(value, 'end'), step + ' has end';
            if (!['check', 'cleanup'].includes(step)) {
              assert.notProperty(value, 'text', step + ' does not have text');
            }
          });

          assert.property(response.steps.check, 'text');
          assert.property(response.steps.cleanup, 'text');
          assert.property(response.steps.check, 'images');

          done();
        });
      });
    });

    describe('GET /api/v1/job with unknown steps parameter', () => {
      it('should have the default behaviour', (done) => {
        request(global.test_host + '/api/v1/job/' + job_id + '?steps=none', (err, res, body) => {
          assert.ifError(err);
          assert.equal(res.statusCode, 200, 'status code OK');
          assert.isObject(JSON.parse(body), 'returned JSON');
          let response = JSON.parse(body);

          assert.property(response, 'steps');
          Object.entries(response.steps).forEach(([step, value], index, array) => {
            assert.property(value, 'status', step + ' has status');
            assert.property(value, 'start', step + ' has start');
            assert.property(value, 'end'), step + ' has end';
            assert.notProperty(value, 'text', step + ' does not have text');
            assert.notProperty(value, 'statuscode', step + ' does not have statuscode');
            assert.notProperty(value, 'images', step + ' does not have images');
            assert.notProperty(value, 'manifest', step + ' does not have manifest');
          });

          done();
        });
      });
    });
  });
});
