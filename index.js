'use strict';
//==============================================================
require('dotenv').config();
const AWS = require('aws-sdk');
      AWS.config.update({region: process.env.AWS_REGION});
const dynamoDBClient = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();
const s3 = new AWS.S3();
const sqs = new AWS.SQS();
//==============================================================
function AWSContainer() {}
AWSContainer.prototype.AWS = AWS;
AWSContainer.prototype.dynamoDBClient = dynamoDBClient;
AWSContainer.prototype.lambda = lambda;
AWSContainer.prototype.s3 = s3;
AWSContainer.prototype.sqs = sqs;
//==============================================================
// validate permission on service interface
function validatePermission(event, permission) {
  return new Promise((resolve, reject) => {
    console.log(`### validPermission :: `, event._serviceInterface);
    // console.log(event);
    if(
      !event
      || !permission
      || !permission[event._serviceInterface]
    )
    {
      if(event.Records)
      {
        resolve();
        return;
      }
      reject({err:{awsServerlessBuilder:{
        where: 'ServiceInterfacePermissionValidation',
        information: `Service Interface Permission Denied`,
        time: new Date(),
      }}});
      return;
    }
    else
    {
      resolve();
      return;
    }
  });
}
//==============================================================
// validate user-input values
function validateInput(permission, validation) {
  return new Promise((resolve, reject) => {
    console.log(`### validInput :: `, validation);
    //------------------------------------------------------
    // console.log(validation.input.event);
    let _valdInptEvnt = validation.input.event,
        ruleKeys = Object.keys(validation.rule),  // get rule keys from rule object
        err = {};
    //------------------------------------------------------
    const doResolve = (validationResult) => {
      let _wssClient = false;
      // check this request is from websocket
      // then create wssClient
      console.log(11);
      console.log(_valdInptEvnt);
      if(
        permission.websocket
        &&_valdInptEvnt
        &&_valdInptEvnt._serviceInterface==='websocket'
        &&_valdInptEvnt._wssEndpoint
        &&_valdInptEvnt._wssConnectionId
      )
      {
        console.log(12);
        _wssClient = new AWS.ApiGatewayManagementApi({endpoint: _valdInptEvnt._wssEndpoint});
      }
      console.log(_wssClient);
      resolve({
        validatedParam: validationResult,
        websocketClient: _wssClient
      });
    };
    //------------------------------------------------------
    // no rules
    if(Number(ruleKeys.length)===0)
    {
      doResolve(validation);
      return;
    }
    //------------------------------------------------------
    // loop - ruleKeys[]
    for(let i = 0, _length_i = ruleKeys.length; i < _length_i; i += 1)
    {
      let rule = validation.rule[ruleKeys[i]];
      //------------------------------------------------------
      // check existance
      if(rule.required||rule.require)
      {
        if(!_valdInptEvnt || !_valdInptEvnt[ruleKeys[i]])
        {
          if(!err[ruleKeys[i]]) err[ruleKeys[i]] = [];
          err[ruleKeys[i]].push('is required');
        }
      }
      //------------------------------------------------------
      // check typeof
      if(rule.type)
      {
        if(_valdInptEvnt && _valdInptEvnt[ruleKeys[i]])
        {
          let _thisInputValue = _valdInptEvnt[ruleKeys[i]];
          
          // console.log(ruleKeys[i]);
          // console.log(rule.type);
          // console.log(_thisInputValue);
          // console.log(typeof _thisInputValue);
          // console.log(Array.isArray(_thisInputValue));
          if(rule.type === 'object')
          {
            if(Array.isArray(_thisInputValue))
            {
              
            }
          }
          if(rule.type === 'number')
          {
            _thisInputValue = Number(_valdInptEvnt[ruleKeys[i]]);
          }
          if(rule.type !== typeof _thisInputValue)
          {
            if(!err[ruleKeys[i]]) err[ruleKeys[i]] = [];
            err[ruleKeys[i]].push('must be '+rule.type);
          }
        }
      }
      //------------------------------------------------------
      // check default value exist
      if(rule.default)
      {
        if(!_valdInptEvnt || !_valdInptEvnt[ruleKeys[i]])
        {
          // set default value if not exist
          _valdInptEvnt[ruleKeys[i]] = rule.default;
        }
      }
      //------------------------------------------------------
      // at last
      if(_length_i-1 === Number(i))
      {
        //------------------------------------------------------
        if(Object.keys(err).length > 0)
        {
          reject({awsServerlessBuilder:{
            where: 'InputValidation',
            time: new Date(),
            information: err,
          }});
        }
        else
        {
          doResolve(validation);
        }
      }
    }
  });
}
//==============================================================
function runPreProcessFunctions (functionList, permission, inputEvent, inputContext, outputFormat, websocketClient) {
  return new Promise((resolve, reject) => {
    (async () => {
    //------------------------------------------------------
    if(functionList.length == 0)
    {
      resolve();
      return;
    }
    //------------------------------------------------------
    const runAllFunctionList = async (functionIndex, previousFunctionResult) => {
      //------------------------------------------------------
      // check environment - prod or dev..
      let _stageEnv = inputContext.functionName.match(/-dev([0-9]*)/);
      if(_stageEnv && _stageEnv.length>0)
      {
        // _stageEnv[0];
      }
      //------------------------------------------------------
      // console.log(inputContext);
      // console.log(inputContext.functionName);
      // console.log(functionIndex);
      //------------------------------------------------------
      let _isNOT_ENOUGH_RUNCONDITION = false;
      let _conditionKeyValidaionError = [];  // loop for all conditions
      let _conditionEventKeys = [];
      if(functionList[functionIndex].runCondition.event)
      {
        // check runCondition - get keys of condition
        _conditionEventKeys = Object.keys(functionList[functionIndex].runCondition.event);
      }
      console.log(`============================================================`);
      console.log(`===== [${functionIndex}] ${functionList[functionIndex].functionName?functionList[functionIndex].functionName:'IN-LINE FUNCTION'} [${_stageEnv[0]}]`);
      //------------------------------------------------------
      for(let i = 0, _length_i = _conditionEventKeys.length; i < _length_i; i += 1)
      {
        //------------------------------------------------------
        // assign input event value by - previousResultConditionalEvent
        if(functionList[functionIndex].previousResultConditionalEvent)
        {
          console.log(`===== previousResultConditionalEvent -----------------------`);
          console.log(previousFunctionResult);
          for(let l = 0, _length_l = functionList[functionIndex].previousResultConditionalEvent.length; l < _length_l; l += 1)
          {
            let prevCndtVlu = getValueByJsonPath(previousFunctionResult,functionList[functionIndex].previousResultConditionalEvent[l].jsonPath);
            // console.log(`${functionList[functionIndex].previousResultConditionalEvent[l].jsonPath} :: ${functionList[functionIndex].previousResultConditionalEvent[l].eventKey}`);
            // console.log(prevCndtVlu);
            if(
              prevCndtVlu
              && functionList[functionIndex].previousResultConditionalEvent[l].eventKey
            )
            {
              functionList[functionIndex].event[functionList[functionIndex].previousResultConditionalEvent[l].eventKey] = prevCndtVlu;
            }
          }
        }
        //------------------------------------------------------
        // let _conditionEventKeys[i] = _conditionEventKeys[i];
        let _conditionalValueList = functionList[functionIndex].runCondition.event[_conditionEventKeys[i]];
        if(!Array.isArray(_conditionalValueList)) _conditionalValueList = [_conditionalValueList];
        // console.log(_conditionalValueList);
        // console.log(Array.isArray(_conditionalValueList));
        let _requireOneList = [];
        //------------------------------------------------------
        // check - required value
        for(let h = 0, _length_h = _conditionalValueList.length; h < _length_h; h += 1)
        {
          // console.log(`${_conditionEventKeys[i]} : ${_conditionalValueList[h]}`);
          // console.log(functionList[functionIndex].event[_conditionalValueList[h]]);
          if(
            _conditionKeyValidaionError.length<1
            &&(_conditionEventKeys[i]==='require'||_conditionEventKeys[i]==='required'||_conditionEventKeys[i]==='requireAll'||_conditionEventKeys[i]==='requiredAll')
            && !functionList[functionIndex].event[_conditionalValueList[h]]
          )
          {
            _conditionKeyValidaionError.push(`preProcessFunction[${functionIndex}] SKIPPED - ONE OF [requireAll-value] IS NOT EXIST :: ${_conditionalValueList[h]}`);
          }
          if(
            _conditionKeyValidaionError.length<1
            &&(_conditionEventKeys[i]==='requireOne'||_conditionEventKeys[i]==='requiredOne')
            // && functionList[functionIndex].event[_conditionalValueList[h]]
          )
          {
            // let index = _requireOneList.indexOf(_conditionalValueList[h]);
            // if(index !== -1) _requireOneList.splice(index, 1);
            if(!functionList[functionIndex].event[_conditionalValueList[h]])
            {
              _requireOneList.push(_conditionalValueList[h]);
            }
            if(_length_h-1===Number(h))
            {
              if(_requireOneList.length===_conditionalValueList.length)
              {
                _conditionKeyValidaionError.push(`preProcessFunction[${functionIndex}] SKIPPED - AT LEAST ONE OF [requireOne-value] MUST BE EXIST :: ${_requireOneList.toString()}`);
              }
            }
          }
          if(
            _conditionKeyValidaionError.length<1
            && _conditionEventKeys[i]==='notExist'
            && functionList[functionIndex].event[_conditionalValueList[h]]
          )
          {
            _conditionKeyValidaionError.push(`preProcessFunction[${functionIndex}] SKIPPED - ONE OF [notExist-value] IS EXIST :: ${_conditionalValueList[h]}`);
          }
          if(
            _conditionKeyValidaionError.length<1
            &&(_conditionEventKeys[i]==='matchValue')
          )
          {
            // console.log(_conditionalValueList[h]);
            let _matchedValueKeys = Object.keys(_conditionalValueList[h]);
            for(let g = 0, _length_g = _matchedValueKeys.length; g < _length_g; g += 1)
            {
              // console.log(`============[${g}]============`);
              // console.log(functionList[functionIndex].event[_matchedValueKeys[g]]);
              // console.log(_matchedValueKeys[g]);
              // console.log(_conditionalValueList[h][_matchedValueKeys[g]]);
              if(
                functionList[functionIndex].event[_matchedValueKeys[g]]
                !==_conditionalValueList[h][_matchedValueKeys[g]]
              )
              {
                _conditionKeyValidaionError.push(`preProcessFunction[${functionIndex}] SKIPPED - [matchValue] IS NOT MATCHED :: ${_matchedValueKeys[g]} = "${_conditionalValueList[h][_matchedValueKeys[g]]}" BUT "${functionList[functionIndex].event[_matchedValueKeys[g]]}"`);
              }
            }
          }
        }
        //------------------------------------------------------
        // end of loop
        if(_length_i-1===Number(i))
        {
          // run this-function
          // if(_conditionKeyValidaionError.length>0){}
          // console.log('##########################################');
          // console.log(functionList[functionIndex].event);
        }
      }
      //------------------------------------------------------
      // previousFunctionResult
      let _runCndtnPrevResult = functionList[functionIndex].runCondition.previousFunctionResult;
      if(
        _conditionKeyValidaionError.length<1
        &&_runCndtnPrevResult
        &&(
          (_runCndtnPrevResult.require&&_runCndtnPrevResult.require.length>0)
          ||(_runCndtnPrevResult.requireAll&&_runCndtnPrevResult.requireAll.length>0)
        )
      )
      {
        let _requireList = [];
        if(_runCndtnPrevResult.require) _requireList = _runCndtnPrevResult.require;
        if(_runCndtnPrevResult.requireAll) _requireList = _runCndtnPrevResult.requireAll;
        for(let j = 0, _length_j = _requireList.length; j < _length_j; j += 1)
        {
          // console.log(previousFunctionResult);
          // console.log(_requireList[j]);
          // console.log(getValueByJsonPath(previousFunctionResult, _requireList[j]));
          if(!getValueByJsonPath(previousFunctionResult, _requireList[j]))
          {
            // not exist
            _conditionKeyValidaionError.push(`preProcessFunction[${functionIndex}] SKIPPED - ONE OF [requireAll-value] IS NOT EXIST :: ${_requireList[j]}`);
          }
        }
      }
      if(
        _conditionKeyValidaionError.length<1
        &&_runCndtnPrevResult
        &&_runCndtnPrevResult.requireOne
        &&_runCndtnPrevResult.requireOne.length>0
      )
      {
        let _requireOneList = [];
        for(let j = 0, _length_j = _runCndtnPrevResult.requireOne.length; j < _length_j; j += 1)
        {
          // console.log(previousFunctionResult);
          // console.log(_runCndtnPrevResult.requireOne[j]);
          // console.log(getValueByJsonPath(previousFunctionResult, _runCndtnPrevResult.requireOne[j]));
          if(!getValueByJsonPath(previousFunctionResult, _runCndtnPrevResult.requireOne[j]))
          {
            _requireOneList.push(_runCndtnPrevResult.requireOne[j]);
          }
          if(_length_j-1===Number(j))
          {
            if(_requireOneList.length===_runCndtnPrevResult.requireOne.length)
            {
              _conditionKeyValidaionError.push(`preProcessFunction[${functionIndex}] SKIPPED - AT LEAST ONE OF [requireOne-value] MUST BE EXIST :: ${_requireOneList.toString()}`);
            }
          }
        }
      }
      if(
        _conditionKeyValidaionError.length<1
        &&_runCndtnPrevResult
        &&_runCndtnPrevResult.notExist
        &&_runCndtnPrevResult.notExist.length>0
      )
      {
        for(let k = 0, _length_k = _runCndtnPrevResult.notExist.length; k < _length_k; k += 1)
        {
          // console.log(previousFunctionResult);
          // console.log(_runCndtnPrevResult.notExist[k]);
          // console.log(getValueByJsonPath(previousFunctionResult, _runCndtnPrevResult.notExist[k]));
          if(getValueByJsonPath(previousFunctionResult, _runCndtnPrevResult.notExist[k]))
          {
            // exist
            _conditionKeyValidaionError.push(`preProcessFunction[${functionIndex}] SKIPPED - ONE OF [notExist-value] IS EXIST :: ${_runCndtnPrevResult.notExist[k]}`);
          }
        }
      }
      //------------------------------------------------------
      if(_conditionKeyValidaionError.length>0)
      {
        _isNOT_ENOUGH_RUNCONDITION = true;
        console.log(`===== CONDITIONAL VALIDATION ERRORS: `);
        _conditionKeyValidaionError.forEach((errorItem)=>{
          console.log(errorItem);
        });
        console.log(`=========> FUNCTION SKIPPED`);
      }
      //------------------------------------------------------
      // add pipePreviousFunctionResult to result
      if(functionList[functionIndex].pipePreviousFunctionResult)
      {
        if(!previousFunctionResult) previousFunctionResult = {isPreviousFunctionResult:{}};
        if(!previousFunctionResult.isPreviousFunctionResult) previousFunctionResult.isPreviousFunctionResult = {};
        let _passPrvFunResltKeyList = Object.keys(functionList[functionIndex].pipePreviousFunctionResult);
        
        // console.log('======================================');
        // console.log(previousFunctionResult);
        
        for(let m = 0, _length_m = _passPrvFunResltKeyList.length; m < _length_m; m += 1)
        {
          // console.log(_passPrvFunResltKeyList[m]);
          previousFunctionResult.isPreviousFunctionResult[_passPrvFunResltKeyList[m]] = getValueByJsonPath(previousFunctionResult,functionList[functionIndex].pipePreviousFunctionResult[_passPrvFunResltKeyList[m]]);
        }
      }
      // console.log(permission.websocket);
      // console.log(inputEvent);
      // console.log(websocketClient);
      if(
        permission.websocket
        && inputEvent
        && inputEvent._serviceInterface==='websocket'
        && inputEvent._wssEndpoint
        && inputEvent._wssConnectionId
        && websocketClient
      )
      {
          console.log('##### websocketClient.postToConnection --------------------');
          await websocketClient.postToConnection({
            'ConnectionId': inputEvent._wssConnectionId,
            'Data': Buffer.from(JSON.stringify(
              {
                action: `${_isNOT_ENOUGH_RUNCONDITION ? 'skip' : 'run'}`,
                step: `[${Number(functionIndex)+1}/${functionList.length}]`,
                message:`${functionList[functionIndex].webSocketStateCode}`
              }
            ))
          }).promise();
      }
      //------------------------------------------------------
      if(_isNOT_ENOUGH_RUNCONDITION)
      {
        delete previousFunctionResult.isSuccess;
        // skip this preProcessFunction
        // runCondition failed
        if(functionList[functionIndex+1])
        {
          // go next
          // runAllFunctionList(functionIndex+1, false);
          runAllFunctionList(functionIndex+1, previousFunctionResult);
        }
        else
        {
          // finish preProcessFunction
          resolve(previousFunctionResult);
          // reject(_conditionKeyValidaionError);
          // return;
        }
        // resolve(previousFunctionResult);
      }
      else
      {
        console.log(`===== RunFunction ------------------------------------------`);
        //------------------------------------------------------
        let _result = {};
        functionList[functionIndex].event['_serviceInterface'] = 'preprocess';
        // functionList[functionIndex].event['_previousFunctionResult'] = previousFunctionResult;
        //------------------------------------------------------
        const runNext = async (param) => {
          // 
          if(param.functionList[param.functionIndex+1])
          {
            // // console.log(permission.websocket);
            // // console.log(inputEvent);
            // // console.log(websocketClient);
            // if(
            //   permission.websocket
            //   && inputEvent
            //   && inputEvent._serviceInterface==='websocket'
            //   && inputEvent._wssEndpoint
            //   && inputEvent._wssConnectionId
            //   && websocketClient
            // )
            // {
            //   console.log('##### websocketClient.postToConnection --------------------');
            //   await websocketClient.postToConnection({
            //     'ConnectionId': inputEvent._wssConnectionId,
            //     'Data': Buffer.from(JSON.stringify(`[${param.functionIndex}] ${param.functionName}`))
            //     // 'Data': Buffer.from(JSON.stringify(param.result))
            //   }).promise();
            // }
            param.runAllFunctionList(param.functionIndex+1, {...previousFunctionResult, ...param.result});
          }
          else
          {
            if(param.result&&param.result.err)
            {
              console.log(`##### runAllFunctionList[${param.functionIndex}]:err --------------`);
              reject(param.result);
            }
            else
            {
              console.log(`=========> FUNCTION COMPLETED`);
              resolve({...previousFunctionResult, ...param.result});
            }
          }
        };
        //------------------------------------------------------
        if(functionList[functionIndex].runThis)
        {
            functionList[functionIndex].runThis(
              functionList[functionIndex].event,
              inputContext,
              outputFormat,
              (_result) => {
                runNext({
                  runAllFunctionList: runAllFunctionList,
                  functionList: functionList,
                  functionIndex: functionIndex,
                  functionName: functionList[functionIndex].functionName,
                  result: {isSuccess: _result}
                });
              },
              reject,
              previousFunctionResult
            );
        }
        else
        {
            await lambda.invoke({
              FunctionName: `${functionList[functionIndex].functionName}${_stageEnv&&_stageEnv.length>0?`${_stageEnv[0]}`:``}`,
              Payload: JSON.stringify(functionList[functionIndex].event),
              InvocationType: 'RequestResponse',
              LogType: 'None'
            }, (err, output) => {
              if(err)
              {
                console.log(`##### await lambda.invoke:err --------------`);
                console.log(err);
                reject({err:err});
                return;
              }
              let _payload = JSON.parse(output.Payload);
              console.log(_payload);
              if(_payload&&_payload.err) _result.err = _payload.err;
              if(err) _result.err = err;
              if(!_result.err) _result = _payload;
              // console.log(_result);
              //------------------------------------------------------
              runNext({
                runAllFunctionList: runAllFunctionList,
                functionList: functionList,
                functionIndex: functionIndex,
                functionName: functionList[functionIndex].functionName,
                result: _result
              });
            }); // await lambda.invoke
        }
        //------------------------------------------------------
      }
      
    };
    runAllFunctionList(0, false);
    })();
  });
}
//==============================================================
function getValueByJsonPath (jsonObject, jsonPath) {
  // console.log(`*** getValueByJsonPath :: ${jsonPath}`);
  if(!jsonObject||!jsonPath) return false;
  let result = false;
  let pathArray = jsonPath.split('.');
  let jsonPathValue = JSON.parse(JSON.stringify(jsonObject));
  //------------------------------------------------------
  // loop
  for(let i = 0, _length_i = pathArray.length; i < _length_i; i += 1)
  {
    // console.log("===============");
    // console.log(pathArray);
    // console.log(i);
    // console.log(pathArray[i]);
    let _thisPath = pathArray[i];
    let _newArray = false;
    let _matchString = pathArray[i].match(/\[([0-9]*)\]/);
    if(_matchString && _matchString.length>0)
    {
      // console.log(_matchString);
      // console.log(_matchString[0]);
      // console.log(_thisPath.split(_matchString[0]));
      _newArray = pathArray[i].split(_matchString[0]);
      _newArray[1] = _matchString[1];
      // console.log(_newArray);
      // _newArray.splice(1, 0, _matchString[1]); //scrapResult[0] --> [scrapResult,0]
      for(let j = 0, _length_j = _newArray.length; j < _length_j; j += 1)
      {
        if(jsonPathValue[_newArray[j]])
        {
          jsonPathValue = JSON.parse(JSON.stringify(jsonPathValue[_newArray[j]]));
        }
        else
        {
          // value not exist
          return false;
        }
      }
    }
      
    if(!_newArray)
    {
      if(jsonPathValue[_thisPath])
      {
        // console.log(jsonPathValue[_thisPath]);
        jsonPathValue = JSON.parse(JSON.stringify(jsonPathValue[_thisPath]));
      }
      else
      {
        // value not exist
        return false;
      }
    }
    //------------------------------------------------------
    // at last
    if(_length_i-1===Number(i))
    {
      // if(jsonPath!=='s3fileData') console.log(`:: jsonPathVal[${jsonPath}] ::`, jsonPathValue);
      // console.log(jsonPathValue);
      return jsonPathValue;
    }
  }
  return result;
}
//==============================================================
function runConditionalFunctions (functionList, event, context, outputFormat, preProcessResult) {
  return new Promise((resolve, reject) => {
    const runAllConditionalFunctionsList = async () => {
      //------------------------------------------------------
      // no conditionalFunctions
      if(functionList.length == 0)
      {
        resolve();
        return;
      }
      //------------------------------------------------------
      for(let i = 0, _length_i = functionList.length; i < _length_i; i += 1)
      {
        //------------------------------------------------------
        let _runFuctnFlg = [];
        let _fuctCndtnLst = functionList[i].require;
        if(functionList[i].notExist) _fuctCndtnLst = functionList[i].notExist;
        //------------------------------------------------------
        for(let j = 0, _length_j = _fuctCndtnLst.length; j < _length_j; j += 1)
        {
          if(
            functionList[i].require
            && preProcessResult
            && getValueByJsonPath(preProcessResult, _fuctCndtnLst[j])
          )
          {
            _runFuctnFlg.push(_fuctCndtnLst[j]);
          }
          if(
            functionList[i].notExist
            && preProcessResult
            && !getValueByJsonPath(preProcessResult, _fuctCndtnLst[j])
          )
          {
            _runFuctnFlg.push(_fuctCndtnLst[j]);
          }
          // at last
          if(_length_j-1===Number(j))
          {
            // all require items are exist in preProcessResult.isSuccess
            if(_length_j===_runFuctnFlg.length)
            {
              // do - runThis
              // console.log(preProcessResult);
              // console.log(_fuctCndtnLst);
              // console.log(functionList[i].runThis);
              console.log(`*** conditionalFunction[${i}] -------------------------------------------`);
              console.log(`:: require :: `, functionList[i].require);
              console.log(`:: notExist :: `, functionList[i].notExist);
              await functionList[i].runThis(event, context, outputFormat, resolve, reject, preProcessResult);
              return;
            } 
            else // some items are not exist
            {
              resolve();
            }
          }
        }
        //------------------------------------------------------
        // at last
        if(_length_i-1 === Number(i))
        {
          // all conditionalFunctions did not run
          resolve();
        }
      }
      
    };
    runAllConditionalFunctionsList();
  });
}
//==============================================================
function processLambdaFunction (param) {
  return new Promise((resolve, reject) => {
    //------------------------------------------------------
    // validate permission
    validatePermission(
      param.validation.input.event,
      param.permission,
    ).then(() => {
      //------------------------------------------------------
      // validate input values
      // this only returns "resolve"
      // if error happens "resolve" with err
      validateInput(
        param.permission,
        param.validation,
      ).then(inputValidationResult => {
        //------------------------------------------------------
        // console.log(inputValidationResult);
        // do - runPreProcessFunctions
        runPreProcessFunctions(
          param.preProcessFunctions,
          param.permission,
          inputValidationResult.validatedParam.input.event,
          inputValidationResult.validatedParam.input.context,
          param.outputFormat,
          inputValidationResult.websocketClient
          // param.preProcessFunctions,
          // param.validation.input,
          // param.outputFormat
        ).then(preProcessResult => {
          //------------------------------------------------------
          delete inputValidationResult.validatedParam.input.event['_serviceInterface'];
          // inputValidationResult.validatedParam.input.event = Object.keys(inputValidationResult.validatedParam.input.event).filter(
          //   (key)=> {
          //     return !key.startsWith('_');
          // });
          //------------------------------------------------------
          // do - runConditionalFunctions
          runConditionalFunctions(
            param.conditionalFunctions,
            inputValidationResult.validatedParam.input.event,
            inputValidationResult.validatedParam.input.context,
            param.outputFormat,
            preProcessResult,
          ).then(conditionalFunctionResult => {
            //------------------------------------------------------
            if(
              conditionalFunctionResult
              // && (
              //   conditionalFunctionResult.isDynamoDBResult
              //   || conditionalFunctionResult.isMySQLResultRow
              // )
            )
            {
              console.log(`============================================================`);
              console.log(`===== conditionalFunction ----------------------------------`);
              // resolve - result - end of process
              resolve(conditionalFunctionResult);
            }
            else
            {
              // run defaultFunction
              console.log(`============================================================`);
              console.log(`===== defaultFunction --------------------------------------`);
              param.defaultFunction(
                inputValidationResult.validatedParam.input.event,
                inputValidationResult.validatedParam.input.context,
                param.outputFormat,
                resolve,
                reject,
                preProcessResult,
              );
            }
            //------------------------------------------------------
          }).catch(conditionalFunctionError => {
            // throw err - reject
            reject(conditionalFunctionError);
          });
          //------------------------------------------------------
        }).catch(preProcessErrorResult => {
          // throw err - reject
          reject(preProcessErrorResult);
        });
        //------------------------------------------------------
      }).catch(validatedParam => {
        // validation failed - reject
        reject(validatedParam);
      });
      //------------------------------------------------------
    }).catch(validatePermissionErrorResult => {
      // validation failed - reject
      reject(validatePermissionErrorResult);
    });
  });
}
//==============================================================
function resultFilter (param) {
  // console.log(`@ resultFilter :: ${param}`);
  let _result = {isSuccess:{}};
  //------------------------------------------------------
  // result - dynamoDB, MySQL
  if(param && param.isDynamoDBResult)
  {
    if(param.isDynamoDBResult.Item)
    {
      _result.isSuccess[param.outputFormat.itemName] = param.isDynamoDBResult.Item;
      delete param.isDynamoDBResult.Item;
      _result.isSuccess = {..._result.isSuccess, ...param.isDynamoDBResult};
    }
    else if(param.isDynamoDBResult.Items)
    {
      _result.isSuccess[param.outputFormat.itemName+'List'] = param.isDynamoDBResult.Items;
      delete param.isDynamoDBResult.Items;
      _result.isSuccess = {..._result.isSuccess, ...param.isDynamoDBResult};
    }
    else
    {
      _result.isSuccess = {..._result.isSuccess, ...param.isDynamoDBResult};
    }
  }
  else if(param && param.isMySQLResultRow)
  {
    if(param.isMySQLResultRow.length==1) _result.isSuccess[param.outputFormat.itemName] = param.isMySQLResultRow[0];
    else _result.isSuccess[param.outputFormat.itemName+'List'] = param.isMySQLResultRow;
  }
  else if(param && param.isArray)
  {
    if(param.isArray.length==1) _result.isSuccess[param.outputFormat.itemName] = param.isArray[0];
    else _result.isSuccess[param.outputFormat.itemName+'List'] = param.isArray;
  }
  else if(param && param.isJSON)
  {
    _result.isSuccess[param.outputFormat.itemName] = param.isJSON;
  }
  else if(param && param.isString)
  {
    _result.isSuccess[param.outputFormat.itemName] = param.isString;
  }
  
  _result.outputFormat = param.outputFormat;
  _result.time = new Date();
  
  console.log(`============================================================`);
  console.log(`===== FUNCTION:RESULT ======================================`);
  console.log(JSON.stringify(_result));
  
  return _result;
}
//==============================================================
//function returnThen (outputFormat, output) {
function returnThen (param) {
  // console.log(`@ returnThen :: ${param}`);
  return new Promise((resolve, reject) => {
    resolve(resultFilter(param));
  });
}
//==============================================================
function returnCatch (context, err) {
  console.log(`@ returnCatch :: ${context} :: ${err}`);
  console.log(context);
  console.log(err);
  return new Promise((resolve, reject) => {
    let result = {};
    if(err.awsServerlessBuilder)
    {
      result = {
        isFailure: {
          err: err
        }
      };
    }
    else if(err.aws)
    {
      result = {
        isFailure: {
          err: err
        }
      };
    }
    else
    {
      result = {
        isFailure: {
          err: {
            aws: {
              where: context.functionName,
              time: new Date(),
              information: err,
            }
          }
        }
      };
      if(err.toString())
      {
        result.isFailure.err.aws.information = err.toString();
      }
    }
    resolve(result);
  });
}
//==============================================================
function changeTimezone (originalTime,timezone) {
  // console.log('IST now(): ' + originalTime);
  let convertedTime = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
  }).format(originalTime);
  // console.log('Seoul: ' + convertedTime);
  return convertedTime;
}
//==============================================================
function getStagePostfix (functionName, numberOnly) {
  let _stageEnv = functionName.match(/-dev([0-9]*)/), _stageName = '';
  if(_stageEnv && _stageEnv.length>0)
  {
    _stageName = _stageEnv[0];
  }
  if(numberOnly&&numberOnly===true)
  {
    _stageName = _stageName.replace('-dev','');
  }
  return _stageName;
}
//==============================================================
// export
module.exports = {
  AWSContainer,
  processLambdaFunction,
  returnThen,
  returnCatch,
  changeTimezone,
  getValueByJsonPath,
  getStagePostfix
};
