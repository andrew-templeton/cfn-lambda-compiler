
var exec = require('child_process').exec;
var fs = require('fs');

var AWS = require('aws-sdk');
var CfnLambda = require('cfn-lambda');

var S3 = new AWS.S3();

// MAX SIZE IN MB OF A GIVEN STDOUT EXEC BUFFER
var MB_SZ = 10;
var SRC_BUNDLE_LOC = '/tmp/bundle.zip';
var DEST_ZIP_LOC = '/tmp/bundle';
var STAGE_ZIP_LOC = '/tmp/staged.zip';

exports.handler = CfnLambda({
  Create: function(params, reply) {
    console.log('CREATE triggered, delegating to builder: %j', params);
    Build(params, reply);
  },
  Update: function(phys, params, oldParams, reply) {
    console.log('UPDATE triggered, delegating to builder: %j', params);
    Build(params, reply);
  },
  // Just return an OK every time, we aren't cleaning artifacts.
  Delete: function(phys, params, reply) {
    reply();
  },
  SchemaPath: [__dirname, 'schema.json']
});


function Build(params, reply) {
  params.Destination = params.Destination || params.Source;
  console.log('Pulling code from source: %j', params.Source);
  S3.getObject({
    Bucket: params.Source.S3Bucket,
    Key: params.Source.S3Key
  }, function(getZipErr, zipObject) {
    if (getZipErr) {
      console.error('Fatal error while accessing Source object: %j', params.Source);
      console.error('Found error: %j', getZipErr);
      return reply(getZipErr.message || 'UNKNOWN S3 FATAL');
    }
    console.log('Got the zip back!');
    console.log('Writing to disk...');
    fs.writeFile(SRC_BUNDLE_LOC, zipObject.Body, function(writeErr, ack) {
      if (writeErr) {
        console.error('Fatal error while writing bundle zip to disk: %j', writeErr);
        return reply(writeErr.message || 'FATAL DISK WRITE ERR');
      }
      exec('unzip ' + SRC_BUNDLE_LOC + ' -d ' + DEST_ZIP_LOC + ';', {
        cwd: '/tmp',
        maxBuffer: 1024 * 1024 * MB_SZ
      }, function(err, stdout, stderr) {
        if (err) {
          console.error(stderr.toString());
          console.error('There was a fatal error during expansion: %j', err);
          return reply(err.message || 'UNKNOWN FATAL UNZIP ERROR');
        }
        // DO NOT UN-COMMENT UNLESS YOU WANT A HUGE LOG TRAIL
        // console.log(stdout.toString());
        console.log('Expansion complete!');
        console.log('About to WIPE' + DEST_ZIP_LOC + '...');
        exec('rm -rf ./node_modules;', {
          cwd: DEST_ZIP_LOC,
          maxBuffer: 1024 * 1024 * MB_SZ
        }, function(err, stdout, stderr) {
          if (err) {
            console.error(stderr.toString());
            console.error('Broke on wipe of node modules: %j', err);
            return reply(err.message || 'UNKNOWN FATAL WIPE ERR');
          }
          console.log('Removed all old modules!');
          // console.log('Installing npm...');
          // exec('curl -s -S https://www.npmjs.org/install.sh > /tmp/inst.sh ', {
          //   maxBuffer: 1024 * 1024 * MB_SZ
          // }, function(err, stdout, stderr) {
          //   if (err) {
          //     console.error(stderr.toString());
          //     console.error('Error pulling instructions', err);
          //     return reply(err.message || 'FATAL ERROR DOWNLOADING NPM INSTALLER');
          //   }
          //   console.log('Executing installer...');
          //   exec(fs.readFileSync('/tmp/inst.sh').toString(), {
          //     maxBuffer: 1024 * 1024 * MB_SZ
          //   }, function(err, stdout, stderr) {
          //     if (err) {
          //       console.error(stderr.toString());
          //       console.error('Broke while installing npm: %j', err);
          //       return reply(err.message || 'UNKNOWN FATAL INSTALL ERROR');
          //     }
          //     console.log('Installed NPM!');
              console.log('About to npm install;...');
              exec('mkdir -p /tmp/ephem-user && HOME="/tmp/ephem-user" node ' + __dirname + '/node_modules/npm/bin/npm-cli install;', {
                cwd: DEST_ZIP_LOC,
                maxBuffer: 1024 * 1024 * MB_SZ
              }, function(err, stdout, stderr) {
                console.log(stdout.toString());
                if (err) {
                  console.error(stderr.toString());
                  console.error('An error occurred while installing modules: %j', err);
                  return reply(err.message || 'UNKNOWN FATAL NPM INSTALL ERROR');
                }
                console.log('npm install completed!');
                console.log('About to stage the zip bundle to transmission...');
                exec('zip -r ' + STAGE_ZIP_LOC + ' .;', {
                  cwd: DEST_ZIP_LOC,
                  maxBuffer: 1024 * 1024 * MB_SZ
                }, function(err, stdout, stderr) {
                  if (err) {
                    console.error(stderr.toString());
                    console.error('Failed to zip and stage rebuilt module version of app: %j', err);
                    return reply(err.message || 'UNKNOWN FATAL ZIP STAGE ERR');
                  }
                  console.log(stdout.toString());
                  console.log('Staged the .zip bundle for transmission to destination...');
                  console.log('About to write the staged bundle to dest: %j', params.Destination);
                  fs.readFile(STAGE_ZIP_LOC, function(err, stagedZip) {
                    if (err) {
                      console.error('Could not acquire staged zip as buffer off disk: %j', err);
                      return reply(err.message || 'UNKNOWN FATAL STAGED ZIP READ ERROR');
                    }
                    console.log('Pulled staged zip off of disk as buffer...');
                    console.log('Opening connection to S3...');
                    S3.putObject({
                      Bucket: params.Destination.S3Bucket,
                      Key: params.Destination.S3Key,
                      Body: stagedZip
                    }, function(err, confirmation) {
                      if (err) {
                        console.error('Could not transmit finished build to S3: %j', err);
                        return reply(err.message || 'UNKNOWN FATAL BUILD TRANSMIT ERROR');
                      }
                      console.log('Successfully transmitted finished built bundle to S3!');
                      console.log('Closing with SUCCESS.');
                      // This is a BS PhysicalResourceId because I want this to run every time.
                      return reply(null, Date.now().toString());
                    });
                  });
                });
              });
          //   });
          // });
        });
      });
    });
  });
}
