// Copyright 2010 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// The Module object: Our interface to the outside world. We import
// and export values on it. There are various ways Module can be used:
// 1. Not defined. We create it here
// 2. A function parameter, function(Module) { ..generated code.. }
// 3. pre-run appended it, var Module = {}; ..generated code..
// 4. External script tag defines var Module.
// We need to check if Module already exists (e.g. case 3 above).
// Substitution will be replaced with actual code on later stage of the build,
// this way Closure Compiler will not mangle it (e.g. case 4. above).
// Note that if you want to run closure, and also to use Module
// after the generated code, you will need to define   var Module = {};
// before the code. Then that object will be used in the code, and you
// can continue to use Module afterwards as well.
var Module = typeof WABModule !== 'undefined' ? WABModule : {};

// --pre-jses are emitted after the Module integration code, so that they can
// refer to Module (if they choose; they can also define Module)
WABModule.manifest = 
{
    "header" : 
    {
        "platform" : "prologue",
        "module" : "osc",
        "api" : "1.1-0",
        "dev_id" : 0,
        "prg_id" : 0,
        "version" : "0.1-0",
        "name" : "sine",
        "num_param" : 0
    }
}



// Sometimes an existing Module object exists with properties
// meant to overwrite the default module functionality. Here
// we collect those properties and reapply _after_ we configure
// the current environment's defaults to avoid having to be so
// defensive during initialization.
var moduleOverrides = {};
var key;
for (key in Module) {
  if (Module.hasOwnProperty(key)) {
    moduleOverrides[key] = Module[key];
  }
}

var arguments_ = [];
var thisProgram = './this.program';
var quit_ = function(status, toThrow) {
  throw toThrow;
};

// Determine the runtime environment we are in. You can customize this by
// setting the ENVIRONMENT setting at compile time (see settings.js).

var ENVIRONMENT_IS_WEB = false;
var ENVIRONMENT_IS_WORKER = false;
var ENVIRONMENT_IS_NODE = false;
var ENVIRONMENT_HAS_NODE = false;
var ENVIRONMENT_IS_SHELL = false;
ENVIRONMENT_IS_WEB = typeof window === 'object';
ENVIRONMENT_IS_WORKER = typeof importScripts === 'function';
// A web environment like Electron.js can have Node enabled, so we must
// distinguish between Node-enabled environments and Node environments per se.
// This will allow the former to do things like mount NODEFS.
// Extended check using process.versions fixes issue #8816.
// (Also makes redundant the original check that 'require' is a function.)
ENVIRONMENT_HAS_NODE = typeof process === 'object' && typeof process.versions === 'object' && typeof process.versions.node === 'string';
ENVIRONMENT_IS_NODE = ENVIRONMENT_HAS_NODE && !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_WORKER;
ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;



// Three configurations we can be running in:
// 1) We could be the application main() thread running in the main JS UI thread. (ENVIRONMENT_IS_WORKER == false and ENVIRONMENT_IS_PTHREAD == false)
// 2) We could be the application main() thread proxied to worker. (with Emscripten -s PROXY_TO_WORKER=1) (ENVIRONMENT_IS_WORKER == true, ENVIRONMENT_IS_PTHREAD == false)
// 3) We could be an application pthread running in a worker. (ENVIRONMENT_IS_WORKER == true and ENVIRONMENT_IS_PTHREAD == true)




// `/` should be present at the end if `scriptDirectory` is not empty
var scriptDirectory = '';
function locateFile(path) {
  if (Module['locateFile']) {
    return Module['locateFile'](path, scriptDirectory);
  }
  return scriptDirectory + path;
}

// Hooks that are implemented differently in different runtime environments.
var read_,
    readAsync,
    readBinary,
    setWindowTitle;

if (ENVIRONMENT_IS_NODE) {
  scriptDirectory = __dirname + '/';

  // Expose functionality in the same simple way that the shells work
  // Note that we pollute the global namespace here, otherwise we break in node
  var nodeFS;
  var nodePath;

  read_ = function shell_read(filename, binary) {
    var ret;
    ret = tryParseAsDataURI(filename);
    if (!ret) {
      if (!nodeFS) nodeFS = require('fs');
      if (!nodePath) nodePath = require('path');
      filename = nodePath['normalize'](filename);
      ret = nodeFS['readFileSync'](filename);
    }
    return binary ? ret : ret.toString();
  };

  readBinary = function readBinary(filename) {
    var ret = read_(filename, true);
    if (!ret.buffer) {
      ret = new Uint8Array(ret);
    }
    assert(ret.buffer);
    return ret;
  };

  if (process['argv'].length > 1) {
    thisProgram = process['argv'][1].replace(/\\/g, '/');
  }

  arguments_ = process['argv'].slice(2);

  if (typeof module !== 'undefined') {
    module['exports'] = Module;
  }

  process['on']('uncaughtException', function(ex) {
    // suppress ExitStatus exceptions from showing an error
    if (!(ex instanceof ExitStatus)) {
      throw ex;
    }
  });

  process['on']('unhandledRejection', abort);

  quit_ = function(status) {
    process['exit'](status);
  };

  Module['inspect'] = function () { return '[Emscripten Module object]'; };
} else
if (ENVIRONMENT_IS_SHELL) {


  if (typeof read != 'undefined') {
    read_ = function shell_read(f) {
      var data = tryParseAsDataURI(f);
      if (data) {
        return intArrayToString(data);
      }
      return read(f);
    };
  }

  readBinary = function readBinary(f) {
    var data;
    data = tryParseAsDataURI(f);
    if (data) {
      return data;
    }
    if (typeof readbuffer === 'function') {
      return new Uint8Array(readbuffer(f));
    }
    data = read(f, 'binary');
    assert(typeof data === 'object');
    return data;
  };

  if (typeof scriptArgs != 'undefined') {
    arguments_ = scriptArgs;
  } else if (typeof arguments != 'undefined') {
    arguments_ = arguments;
  }

  if (typeof quit === 'function') {
    quit_ = function(status) {
      quit(status);
    };
  }

  if (typeof print !== 'undefined') {
    // Prefer to use print/printErr where they exist, as they usually work better.
    if (typeof console === 'undefined') console = {};
    console.log = print;
    console.warn = console.error = typeof printErr !== 'undefined' ? printErr : print;
  }
} else
if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
  if (ENVIRONMENT_IS_WORKER) { // Check worker, not web, since window could be polyfilled
    scriptDirectory = self.location.href;
  } else if (document.currentScript) { // web
    scriptDirectory = document.currentScript.src;
  }
  // blob urls look like blob:http://site.com/etc/etc and we cannot infer anything from them.
  // otherwise, slice off the final part of the url to find the script directory.
  // if scriptDirectory does not contain a slash, lastIndexOf will return -1,
  // and scriptDirectory will correctly be replaced with an empty string.
  if (scriptDirectory.indexOf('blob:') !== 0) {
    scriptDirectory = scriptDirectory.substr(0, scriptDirectory.lastIndexOf('/')+1);
  } else {
    scriptDirectory = '';
  }


  read_ = function shell_read(url) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.send(null);
      return xhr.responseText;
    } catch (err) {
      var data = tryParseAsDataURI(url);
      if (data) {
        return intArrayToString(data);
      }
      throw err;
    }
  };

  if (ENVIRONMENT_IS_WORKER) {
    readBinary = function readBinary(url) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, false);
        xhr.responseType = 'arraybuffer';
        xhr.send(null);
        return new Uint8Array(xhr.response);
      } catch (err) {
        var data = tryParseAsDataURI(url);
        if (data) {
          return data;
        }
        throw err;
      }
    };
  }

  readAsync = function readAsync(url, onload, onerror) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = function xhr_onload() {
      if (xhr.status == 200 || (xhr.status == 0 && xhr.response)) { // file URLs can return 0
        onload(xhr.response);
        return;
      }
      var data = tryParseAsDataURI(url);
      if (data) {
        onload(data.buffer);
        return;
      }
      onerror();
    };
    xhr.onerror = onerror;
    xhr.send(null);
  };

  setWindowTitle = function(title) { document.title = title };
} else
{
}

// Set up the out() and err() hooks, which are how we can print to stdout or
// stderr, respectively.
var out = Module['print'] || console.log.bind(console);
var err = Module['printErr'] || console.warn.bind(console);

// Merge back in the overrides
for (key in moduleOverrides) {
  if (moduleOverrides.hasOwnProperty(key)) {
    Module[key] = moduleOverrides[key];
  }
}
// Free the object hierarchy contained in the overrides, this lets the GC
// reclaim data used e.g. in memoryInitializerRequest, which is a large typed array.
moduleOverrides = null;

// Emit code to handle expected values on the Module object. This applies Module.x
// to the proper local x. This has two benefits: first, we only emit it if it is
// expected to arrive, and second, by using a local everywhere else that can be
// minified.
if (Module['arguments']) arguments_ = Module['arguments'];
if (Module['thisProgram']) thisProgram = Module['thisProgram'];
if (Module['quit']) quit_ = Module['quit'];

// perform assertions in shell.js after we set up out() and err(), as otherwise if an assertion fails it cannot print the message

// TODO remove when SDL2 is fixed (also see above)



// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// {{PREAMBLE_ADDITIONS}}

var STACK_ALIGN = 16;


function dynamicAlloc(size) {
  var ret = HEAP32[DYNAMICTOP_PTR>>2];
  var end = (ret + size + 15) & -16;
  if (end > _emscripten_get_heap_size()) {
    abort();
  }
  HEAP32[DYNAMICTOP_PTR>>2] = end;
  return ret;
}

function alignMemory(size, factor) {
  if (!factor) factor = STACK_ALIGN; // stack alignment (16-byte) by default
  return Math.ceil(size / factor) * factor;
}

function getNativeTypeSize(type) {
  switch (type) {
    case 'i1': case 'i8': return 1;
    case 'i16': return 2;
    case 'i32': return 4;
    case 'i64': return 8;
    case 'float': return 4;
    case 'double': return 8;
    default: {
      if (type[type.length-1] === '*') {
        return 4; // A pointer
      } else if (type[0] === 'i') {
        var bits = parseInt(type.substr(1));
        assert(bits % 8 === 0, 'getNativeTypeSize invalid bits ' + bits + ', type ' + type);
        return bits / 8;
      } else {
        return 0;
      }
    }
  }
}

function warnOnce(text) {
  if (!warnOnce.shown) warnOnce.shown = {};
  if (!warnOnce.shown[text]) {
    warnOnce.shown[text] = 1;
    err(text);
  }
}

var asm2wasmImports = { // special asm2wasm imports
    "f64-rem": function(x, y) {
        return x % y;
    },
    "debugger": function() {
    }
};



var jsCallStartIndex = 1;
var functionPointers = new Array(0);

// Wraps a JS function as a wasm function with a given signature.
// In the future, we may get a WebAssembly.Function constructor. Until then,
// we create a wasm module that takes the JS function as an import with a given
// signature, and re-exports that as a wasm function.
function convertJsFunctionToWasm(func, sig) {

  // The module is static, with the exception of the type section, which is
  // generated based on the signature passed in.
  var typeSection = [
    0x01, // id: section,
    0x00, // length: 0 (placeholder)
    0x01, // count: 1
    0x60, // form: func
  ];
  var sigRet = sig.slice(0, 1);
  var sigParam = sig.slice(1);
  var typeCodes = {
    'i': 0x7f, // i32
    'j': 0x7e, // i64
    'f': 0x7d, // f32
    'd': 0x7c, // f64
  };

  // Parameters, length + signatures
  typeSection.push(sigParam.length);
  for (var i = 0; i < sigParam.length; ++i) {
    typeSection.push(typeCodes[sigParam[i]]);
  }

  // Return values, length + signatures
  // With no multi-return in MVP, either 0 (void) or 1 (anything else)
  if (sigRet == 'v') {
    typeSection.push(0x00);
  } else {
    typeSection = typeSection.concat([0x01, typeCodes[sigRet]]);
  }

  // Write the overall length of the type section back into the section header
  // (excepting the 2 bytes for the section id and length)
  typeSection[1] = typeSection.length - 2;

  // Rest of the module is static
  var bytes = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, // magic ("\0asm")
    0x01, 0x00, 0x00, 0x00, // version: 1
  ].concat(typeSection, [
    0x02, 0x07, // import section
      // (import "e" "f" (func 0 (type 0)))
      0x01, 0x01, 0x65, 0x01, 0x66, 0x00, 0x00,
    0x07, 0x05, // export section
      // (export "f" (func 0 (type 0)))
      0x01, 0x01, 0x66, 0x00, 0x00,
  ]));

   // We can compile this wasm module synchronously because it is very small.
  // This accepts an import (at "e.f"), that it reroutes to an export (at "f")
  var module = new WebAssembly.Module(bytes);
  var instance = new WebAssembly.Instance(module, {
    e: {
      f: func
    }
  });
  var wrappedFunc = instance.exports.f;
  return wrappedFunc;
}

// Add a wasm function to the table.
function addFunctionWasm(func, sig) {
  var table = wasmTable;
  var ret = table.length;

  // Grow the table
  try {
    table.grow(1);
  } catch (err) {
    if (!err instanceof RangeError) {
      throw err;
    }
    throw 'Unable to grow wasm table. Use a higher value for RESERVED_FUNCTION_POINTERS or set ALLOW_TABLE_GROWTH.';
  }

  // Insert new element
  try {
    // Attempting to call this with JS function will cause of table.set() to fail
    table.set(ret, func);
  } catch (err) {
    if (!err instanceof TypeError) {
      throw err;
    }
    assert(typeof sig !== 'undefined', 'Missing signature argument to addFunction');
    var wrapped = convertJsFunctionToWasm(func, sig);
    table.set(ret, wrapped);
  }

  return ret;
}

function removeFunctionWasm(index) {
  // TODO(sbc): Look into implementing this to allow re-using of table slots
}

// 'sig' parameter is required for the llvm backend but only when func is not
// already a WebAssembly function.
function addFunction(func, sig) {


  var base = 0;
  for (var i = base; i < base + 0; i++) {
    if (!functionPointers[i]) {
      functionPointers[i] = func;
      return jsCallStartIndex + i;
    }
  }
  throw 'Finished up all reserved function pointers. Use a higher value for RESERVED_FUNCTION_POINTERS.';

}

function removeFunction(index) {

  functionPointers[index-jsCallStartIndex] = null;
}

var funcWrappers = {};

function getFuncWrapper(func, sig) {
  if (!func) return; // on null pointer, return undefined
  assert(sig);
  if (!funcWrappers[sig]) {
    funcWrappers[sig] = {};
  }
  var sigCache = funcWrappers[sig];
  if (!sigCache[func]) {
    // optimize away arguments usage in common cases
    if (sig.length === 1) {
      sigCache[func] = function dynCall_wrapper() {
        return dynCall(sig, func);
      };
    } else if (sig.length === 2) {
      sigCache[func] = function dynCall_wrapper(arg) {
        return dynCall(sig, func, [arg]);
      };
    } else {
      // general case
      sigCache[func] = function dynCall_wrapper() {
        return dynCall(sig, func, Array.prototype.slice.call(arguments));
      };
    }
  }
  return sigCache[func];
}


function makeBigInt(low, high, unsigned) {
  return unsigned ? ((+((low>>>0)))+((+((high>>>0)))*4294967296.0)) : ((+((low>>>0)))+((+((high|0)))*4294967296.0));
}

function dynCall(sig, ptr, args) {
  if (args && args.length) {
    return Module['dynCall_' + sig].apply(null, [ptr].concat(args));
  } else {
    return Module['dynCall_' + sig].call(null, ptr);
  }
}

var tempRet0 = 0;

var setTempRet0 = function(value) {
  tempRet0 = value;
};

var getTempRet0 = function() {
  return tempRet0;
};


var Runtime = {
};

// The address globals begin at. Very low in memory, for code size and optimization opportunities.
// Above 0 is static memory, starting with globals.
// Then the stack.
// Then 'dynamic' memory for sbrk.
var GLOBAL_BASE = 1024;




// === Preamble library stuff ===

// Documentation for the public APIs defined in this file must be updated in:
//    site/source/docs/api_reference/preamble.js.rst
// A prebuilt local version of the documentation is available at:
//    site/build/text/docs/api_reference/preamble.js.txt
// You can also build docs locally as HTML or other formats in site/
// An online HTML version (which may be of a different version of Emscripten)
//    is up at http://kripken.github.io/emscripten-site/docs/api_reference/preamble.js.html


var wasmBinary;if (Module['wasmBinary']) wasmBinary = Module['wasmBinary'];
var noExitRuntime;if (Module['noExitRuntime']) noExitRuntime = Module['noExitRuntime'];


if (typeof WebAssembly !== 'object') {
  err('no native wasm support detected');
}


// In MINIMAL_RUNTIME, setValue() and getValue() are only available when building with safe heap enabled, for heap safety checking.
// In traditional runtime, setValue() and getValue() are always available (although their use is highly discouraged due to perf penalties)

/** @type {function(number, number, string, boolean=)} */
function setValue(ptr, value, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': HEAP8[((ptr)>>0)]=value; break;
      case 'i8': HEAP8[((ptr)>>0)]=value; break;
      case 'i16': HEAP16[((ptr)>>1)]=value; break;
      case 'i32': HEAP32[((ptr)>>2)]=value; break;
      case 'i64': (tempI64 = [value>>>0,(tempDouble=value,(+(Math_abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? ((Math_min((+(Math_floor((tempDouble)/4294967296.0))), 4294967295.0))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)],HEAP32[((ptr)>>2)]=tempI64[0],HEAP32[(((ptr)+(4))>>2)]=tempI64[1]); break;
      case 'float': HEAPF32[((ptr)>>2)]=value; break;
      case 'double': HEAPF64[((ptr)>>3)]=value; break;
      default: abort('invalid type for setValue: ' + type);
    }
}

/** @type {function(number, string, boolean=)} */
function getValue(ptr, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': return HEAP8[((ptr)>>0)];
      case 'i8': return HEAP8[((ptr)>>0)];
      case 'i16': return HEAP16[((ptr)>>1)];
      case 'i32': return HEAP32[((ptr)>>2)];
      case 'i64': return HEAP32[((ptr)>>2)];
      case 'float': return HEAPF32[((ptr)>>2)];
      case 'double': return HEAPF64[((ptr)>>3)];
      default: abort('invalid type for getValue: ' + type);
    }
  return null;
}





// Wasm globals

var wasmMemory;

// Potentially used for direct table calls.
var wasmTable;


//========================================
// Runtime essentials
//========================================

// whether we are quitting the application. no code should run after this.
// set in exit() and abort()
var ABORT = false;

// set by exit() and abort().  Passed to 'onExit' handler.
// NOTE: This is also used as the process return code code in shell environments
// but only when noExitRuntime is false.
var EXITSTATUS = 0;

/** @type {function(*, string=)} */
function assert(condition, text) {
  if (!condition) {
    abort('Assertion failed: ' + text);
  }
}

// Returns the C function with a specified identifier (for C++, you need to do manual name mangling)
function getCFunc(ident) {
  var func = Module['_' + ident]; // closure exported function
  assert(func, 'Cannot call unknown function ' + ident + ', make sure it is exported');
  return func;
}

// C calling interface.
function ccall(ident, returnType, argTypes, args, opts) {
  // For fast lookup of conversion functions
  var toC = {
    'string': function(str) {
      var ret = 0;
      if (str !== null && str !== undefined && str !== 0) { // null string
        // at most 4 bytes per UTF-8 code point, +1 for the trailing '\0'
        var len = (str.length << 2) + 1;
        ret = stackAlloc(len);
        stringToUTF8(str, ret, len);
      }
      return ret;
    },
    'array': function(arr) {
      var ret = stackAlloc(arr.length);
      writeArrayToMemory(arr, ret);
      return ret;
    }
  };

  function convertReturnValue(ret) {
    if (returnType === 'string') return UTF8ToString(ret);
    if (returnType === 'boolean') return Boolean(ret);
    return ret;
  }

  var func = getCFunc(ident);
  var cArgs = [];
  var stack = 0;
  if (args) {
    for (var i = 0; i < args.length; i++) {
      var converter = toC[argTypes[i]];
      if (converter) {
        if (stack === 0) stack = stackSave();
        cArgs[i] = converter(args[i]);
      } else {
        cArgs[i] = args[i];
      }
    }
  }
  var ret = func.apply(null, cArgs);

  ret = convertReturnValue(ret);
  if (stack !== 0) stackRestore(stack);
  return ret;
}

function cwrap(ident, returnType, argTypes, opts) {
  argTypes = argTypes || [];
  // When the function takes numbers and returns a number, we can just return
  // the original function
  var numericArgs = argTypes.every(function(type){ return type === 'number'});
  var numericRet = returnType !== 'string';
  if (numericRet && numericArgs && !opts) {
    return getCFunc(ident);
  }
  return function() {
    return ccall(ident, returnType, argTypes, arguments, opts);
  }
}

var ALLOC_NORMAL = 0; // Tries to use _malloc()
var ALLOC_STACK = 1; // Lives for the duration of the current function call
var ALLOC_DYNAMIC = 2; // Cannot be freed except through sbrk
var ALLOC_NONE = 3; // Do not allocate

// allocate(): This is for internal use. You can use it yourself as well, but the interface
//             is a little tricky (see docs right below). The reason is that it is optimized
//             for multiple syntaxes to save space in generated code. So you should
//             normally not use allocate(), and instead allocate memory using _malloc(),
//             initialize it with setValue(), and so forth.
// @slab: An array of data, or a number. If a number, then the size of the block to allocate,
//        in *bytes* (note that this is sometimes confusing: the next parameter does not
//        affect this!)
// @types: Either an array of types, one for each byte (or 0 if no type at that position),
//         or a single type which is used for the entire block. This only matters if there
//         is initial data - if @slab is a number, then this does not matter at all and is
//         ignored.
// @allocator: How to allocate memory, see ALLOC_*
/** @type {function((TypedArray|Array<number>|number), string, number, number=)} */
function allocate(slab, types, allocator, ptr) {
  var zeroinit, size;
  if (typeof slab === 'number') {
    zeroinit = true;
    size = slab;
  } else {
    zeroinit = false;
    size = slab.length;
  }

  var singleType = typeof types === 'string' ? types : null;

  var ret;
  if (allocator == ALLOC_NONE) {
    ret = ptr;
  } else {
    ret = [_malloc,
    stackAlloc,
    dynamicAlloc][allocator](Math.max(size, singleType ? 1 : types.length));
  }

  if (zeroinit) {
    var stop;
    ptr = ret;
    assert((ret & 3) == 0);
    stop = ret + (size & ~3);
    for (; ptr < stop; ptr += 4) {
      HEAP32[((ptr)>>2)]=0;
    }
    stop = ret + size;
    while (ptr < stop) {
      HEAP8[((ptr++)>>0)]=0;
    }
    return ret;
  }

  if (singleType === 'i8') {
    if (slab.subarray || slab.slice) {
      HEAPU8.set(/** @type {!Uint8Array} */ (slab), ret);
    } else {
      HEAPU8.set(new Uint8Array(slab), ret);
    }
    return ret;
  }

  var i = 0, type, typeSize, previousType;
  while (i < size) {
    var curr = slab[i];

    type = singleType || types[i];
    if (type === 0) {
      i++;
      continue;
    }

    if (type == 'i64') type = 'i32'; // special case: we have one i32 here, and one i32 later

    setValue(ret+i, curr, type);

    // no need to look up size unless type changes, so cache it
    if (previousType !== type) {
      typeSize = getNativeTypeSize(type);
      previousType = type;
    }
    i += typeSize;
  }

  return ret;
}

// Allocate memory during any stage of startup - static memory early on, dynamic memory later, malloc when ready
function getMemory(size) {
  if (!runtimeInitialized) return dynamicAlloc(size);
  return _malloc(size);
}




/** @type {function(number, number=)} */
function Pointer_stringify(ptr, length) {
  abort("this function has been removed - you should use UTF8ToString(ptr, maxBytesToRead) instead!");
}

// Given a pointer 'ptr' to a null-terminated ASCII-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.

function AsciiToString(ptr) {
  var str = '';
  while (1) {
    var ch = HEAPU8[((ptr++)>>0)];
    if (!ch) return str;
    str += String.fromCharCode(ch);
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in ASCII form. The copy will require at most str.length+1 bytes of space in the HEAP.

function stringToAscii(str, outPtr) {
  return writeAsciiToMemory(str, outPtr, false);
}


// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the given array that contains uint8 values, returns
// a copy of that string as a Javascript String object.

var UTF8Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf8') : undefined;

/**
 * @param {number} idx
 * @param {number=} maxBytesToRead
 * @return {string}
 */
function UTF8ArrayToString(u8Array, idx, maxBytesToRead) {
  var endIdx = idx + maxBytesToRead;
  var endPtr = idx;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on null terminator by itself.
  // Also, use the length info to avoid running tiny strings through TextDecoder, since .subarray() allocates garbage.
  // (As a tiny code save trick, compare endPtr against endIdx using a negation, so that undefined means Infinity)
  while (u8Array[endPtr] && !(endPtr >= endIdx)) ++endPtr;

  if (endPtr - idx > 16 && u8Array.subarray && UTF8Decoder) {
    return UTF8Decoder.decode(u8Array.subarray(idx, endPtr));
  } else {
    var str = '';
    // If building with TextDecoder, we have already computed the string length above, so test loop end condition against that
    while (idx < endPtr) {
      // For UTF8 byte structure, see:
      // http://en.wikipedia.org/wiki/UTF-8#Description
      // https://www.ietf.org/rfc/rfc2279.txt
      // https://tools.ietf.org/html/rfc3629
      var u0 = u8Array[idx++];
      if (!(u0 & 0x80)) { str += String.fromCharCode(u0); continue; }
      var u1 = u8Array[idx++] & 63;
      if ((u0 & 0xE0) == 0xC0) { str += String.fromCharCode(((u0 & 31) << 6) | u1); continue; }
      var u2 = u8Array[idx++] & 63;
      if ((u0 & 0xF0) == 0xE0) {
        u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
      } else {
        u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (u8Array[idx++] & 63);
      }

      if (u0 < 0x10000) {
        str += String.fromCharCode(u0);
      } else {
        var ch = u0 - 0x10000;
        str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
      }
    }
  }
  return str;
}

// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the emscripten HEAP, returns a
// copy of that string as a Javascript String object.
// maxBytesToRead: an optional length that specifies the maximum number of bytes to read. You can omit
//                 this parameter to scan the string until the first \0 byte. If maxBytesToRead is
//                 passed, and the string at [ptr, ptr+maxBytesToReadr[ contains a null byte in the
//                 middle, then the string will cut short at that byte index (i.e. maxBytesToRead will
//                 not produce a string of exact length [ptr, ptr+maxBytesToRead[)
//                 N.B. mixing frequent uses of UTF8ToString() with and without maxBytesToRead may
//                 throw JS JIT optimizations off, so it is worth to consider consistently using one
//                 style or the other.
/**
 * @param {number} ptr
 * @param {number=} maxBytesToRead
 * @return {string}
 */
function UTF8ToString(ptr, maxBytesToRead) {
  return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : '';
}

// Copies the given Javascript String object 'str' to the given byte array at address 'outIdx',
// encoded in UTF8 form and null-terminated. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8 to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outU8Array: the array to copy to. Each index in this array is assumed to be one 8-byte element.
//   outIdx: The starting offset in the array to begin the copying.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array.
//                    This count should include the null terminator,
//                    i.e. if maxBytesToWrite=1, only the null terminator will be written and nothing else.
//                    maxBytesToWrite=0 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8Array(str, outU8Array, outIdx, maxBytesToWrite) {
  if (!(maxBytesToWrite > 0)) // Parameter maxBytesToWrite is not optional. Negative values, 0, null, undefined and false each don't write out any bytes.
    return 0;

  var startIdx = outIdx;
  var endIdx = outIdx + maxBytesToWrite - 1; // -1 for string null terminator.
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description and https://www.ietf.org/rfc/rfc2279.txt and https://tools.ietf.org/html/rfc3629
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) {
      var u1 = str.charCodeAt(++i);
      u = 0x10000 + ((u & 0x3FF) << 10) | (u1 & 0x3FF);
    }
    if (u <= 0x7F) {
      if (outIdx >= endIdx) break;
      outU8Array[outIdx++] = u;
    } else if (u <= 0x7FF) {
      if (outIdx + 1 >= endIdx) break;
      outU8Array[outIdx++] = 0xC0 | (u >> 6);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else if (u <= 0xFFFF) {
      if (outIdx + 2 >= endIdx) break;
      outU8Array[outIdx++] = 0xE0 | (u >> 12);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else {
      if (outIdx + 3 >= endIdx) break;
      outU8Array[outIdx++] = 0xF0 | (u >> 18);
      outU8Array[outIdx++] = 0x80 | ((u >> 12) & 63);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    }
  }
  // Null-terminate the pointer to the buffer.
  outU8Array[outIdx] = 0;
  return outIdx - startIdx;
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF8 form. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8 to compute the exact number of bytes (excluding null terminator) that this function will write.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8(str, outPtr, maxBytesToWrite) {
  return stringToUTF8Array(str, HEAPU8,outPtr, maxBytesToWrite);
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF8 byte array, EXCLUDING the null terminator byte.
function lengthBytesUTF8(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) u = 0x10000 + ((u & 0x3FF) << 10) | (str.charCodeAt(++i) & 0x3FF);
    if (u <= 0x7F) ++len;
    else if (u <= 0x7FF) len += 2;
    else if (u <= 0xFFFF) len += 3;
    else len += 4;
  }
  return len;
}


// Given a pointer 'ptr' to a null-terminated UTF16LE-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.

var UTF16Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-16le') : undefined;
function UTF16ToString(ptr) {
  var endPtr = ptr;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on null terminator by itself.
  // Also, use the length info to avoid running tiny strings through TextDecoder, since .subarray() allocates garbage.
  var idx = endPtr >> 1;
  while (HEAP16[idx]) ++idx;
  endPtr = idx << 1;

  if (endPtr - ptr > 32 && UTF16Decoder) {
    return UTF16Decoder.decode(HEAPU8.subarray(ptr, endPtr));
  } else {
    var i = 0;

    var str = '';
    while (1) {
      var codeUnit = HEAP16[(((ptr)+(i*2))>>1)];
      if (codeUnit == 0) return str;
      ++i;
      // fromCharCode constructs a character from a UTF-16 code unit, so we can pass the UTF16 string right through.
      str += String.fromCharCode(codeUnit);
    }
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF16 form. The copy will require at most str.length*4+2 bytes of space in the HEAP.
// Use the function lengthBytesUTF16() to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outPtr: Byte address in Emscripten HEAP where to write the string to.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array. This count should include the null
//                    terminator, i.e. if maxBytesToWrite=2, only the null terminator will be written and nothing else.
//                    maxBytesToWrite<2 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF16(str, outPtr, maxBytesToWrite) {
  // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 0x7FFFFFFF;
  }
  if (maxBytesToWrite < 2) return 0;
  maxBytesToWrite -= 2; // Null terminator.
  var startPtr = outPtr;
  var numCharsToWrite = (maxBytesToWrite < str.length*2) ? (maxBytesToWrite / 2) : str.length;
  for (var i = 0; i < numCharsToWrite; ++i) {
    // charCodeAt returns a UTF-16 encoded code unit, so it can be directly written to the HEAP.
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    HEAP16[((outPtr)>>1)]=codeUnit;
    outPtr += 2;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP16[((outPtr)>>1)]=0;
  return outPtr - startPtr;
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF16 byte array, EXCLUDING the null terminator byte.

function lengthBytesUTF16(str) {
  return str.length*2;
}

function UTF32ToString(ptr) {
  var i = 0;

  var str = '';
  while (1) {
    var utf32 = HEAP32[(((ptr)+(i*4))>>2)];
    if (utf32 == 0)
      return str;
    ++i;
    // Gotcha: fromCharCode constructs a character from a UTF-16 encoded code (pair), not from a Unicode code point! So encode the code point to UTF-16 for constructing.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    if (utf32 >= 0x10000) {
      var ch = utf32 - 0x10000;
      str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
    } else {
      str += String.fromCharCode(utf32);
    }
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF32 form. The copy will require at most str.length*4+4 bytes of space in the HEAP.
// Use the function lengthBytesUTF32() to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outPtr: Byte address in Emscripten HEAP where to write the string to.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array. This count should include the null
//                    terminator, i.e. if maxBytesToWrite=4, only the null terminator will be written and nothing else.
//                    maxBytesToWrite<4 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF32(str, outPtr, maxBytesToWrite) {
  // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 0x7FFFFFFF;
  }
  if (maxBytesToWrite < 4) return 0;
  var startPtr = outPtr;
  var endPtr = startPtr + maxBytesToWrite - 4;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) {
      var trailSurrogate = str.charCodeAt(++i);
      codeUnit = 0x10000 + ((codeUnit & 0x3FF) << 10) | (trailSurrogate & 0x3FF);
    }
    HEAP32[((outPtr)>>2)]=codeUnit;
    outPtr += 4;
    if (outPtr + 4 > endPtr) break;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP32[((outPtr)>>2)]=0;
  return outPtr - startPtr;
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF16 byte array, EXCLUDING the null terminator byte.

function lengthBytesUTF32(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var codeUnit = str.charCodeAt(i);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) ++i; // possibly a lead surrogate, so skip over the tail surrogate.
    len += 4;
  }

  return len;
}

// Allocate heap space for a JS string, and write it there.
// It is the responsibility of the caller to free() that memory.
function allocateUTF8(str) {
  var size = lengthBytesUTF8(str) + 1;
  var ret = _malloc(size);
  if (ret) stringToUTF8Array(str, HEAP8, ret, size);
  return ret;
}

// Allocate stack space for a JS string, and write it there.
function allocateUTF8OnStack(str) {
  var size = lengthBytesUTF8(str) + 1;
  var ret = stackAlloc(size);
  stringToUTF8Array(str, HEAP8, ret, size);
  return ret;
}

// Deprecated: This function should not be called because it is unsafe and does not provide
// a maximum length limit of how many bytes it is allowed to write. Prefer calling the
// function stringToUTF8Array() instead, which takes in a maximum length that can be used
// to be secure from out of bounds writes.
/** @deprecated */
function writeStringToMemory(string, buffer, dontAddNull) {
  warnOnce('writeStringToMemory is deprecated and should not be called! Use stringToUTF8() instead!');

  var /** @type {number} */ lastChar, /** @type {number} */ end;
  if (dontAddNull) {
    // stringToUTF8Array always appends null. If we don't want to do that, remember the
    // character that existed at the location where the null will be placed, and restore
    // that after the write (below).
    end = buffer + lengthBytesUTF8(string);
    lastChar = HEAP8[end];
  }
  stringToUTF8(string, buffer, Infinity);
  if (dontAddNull) HEAP8[end] = lastChar; // Restore the value under the null character.
}

function writeArrayToMemory(array, buffer) {
  HEAP8.set(array, buffer);
}

function writeAsciiToMemory(str, buffer, dontAddNull) {
  for (var i = 0; i < str.length; ++i) {
    HEAP8[((buffer++)>>0)]=str.charCodeAt(i);
  }
  // Null-terminate the pointer to the HEAP.
  if (!dontAddNull) HEAP8[((buffer)>>0)]=0;
}




// Memory management

var PAGE_SIZE = 16384;
var WASM_PAGE_SIZE = 65536;
var ASMJS_PAGE_SIZE = 16777216;

function alignUp(x, multiple) {
  if (x % multiple > 0) {
    x += multiple - (x % multiple);
  }
  return x;
}

var HEAP,
/** @type {ArrayBuffer} */
  buffer,
/** @type {Int8Array} */
  HEAP8,
/** @type {Uint8Array} */
  HEAPU8,
/** @type {Int16Array} */
  HEAP16,
/** @type {Uint16Array} */
  HEAPU16,
/** @type {Int32Array} */
  HEAP32,
/** @type {Uint32Array} */
  HEAPU32,
/** @type {Float32Array} */
  HEAPF32,
/** @type {Float64Array} */
  HEAPF64;

function updateGlobalBufferAndViews(buf) {
  buffer = buf;
  Module['HEAP8'] = HEAP8 = new Int8Array(buf);
  Module['HEAP16'] = HEAP16 = new Int16Array(buf);
  Module['HEAP32'] = HEAP32 = new Int32Array(buf);
  Module['HEAPU8'] = HEAPU8 = new Uint8Array(buf);
  Module['HEAPU16'] = HEAPU16 = new Uint16Array(buf);
  Module['HEAPU32'] = HEAPU32 = new Uint32Array(buf);
  Module['HEAPF32'] = HEAPF32 = new Float32Array(buf);
  Module['HEAPF64'] = HEAPF64 = new Float64Array(buf);
}


var STATIC_BASE = 1024,
    STACK_BASE = 18992,
    STACKTOP = STACK_BASE,
    STACK_MAX = 5261872,
    DYNAMIC_BASE = 5261872,
    DYNAMICTOP_PTR = 18960;




var TOTAL_STACK = 5242880;

var INITIAL_TOTAL_MEMORY = Module['TOTAL_MEMORY'] || 16777216;








  if (Module['wasmMemory']) {
    wasmMemory = Module['wasmMemory'];
  } else
  {
    wasmMemory = new WebAssembly.Memory({
      'initial': INITIAL_TOTAL_MEMORY / WASM_PAGE_SIZE
    });
  }


if (wasmMemory) {
  buffer = wasmMemory.buffer;
}

// If the user provides an incorrect length, just use that length instead rather than providing the user to
// specifically provide the memory length with Module['TOTAL_MEMORY'].
INITIAL_TOTAL_MEMORY = buffer.byteLength;
updateGlobalBufferAndViews(buffer);

HEAP32[DYNAMICTOP_PTR>>2] = DYNAMIC_BASE;









function callRuntimeCallbacks(callbacks) {
  while(callbacks.length > 0) {
    var callback = callbacks.shift();
    if (typeof callback == 'function') {
      callback();
      continue;
    }
    var func = callback.func;
    if (typeof func === 'number') {
      if (callback.arg === undefined) {
        Module['dynCall_v'](func);
      } else {
        Module['dynCall_vi'](func, callback.arg);
      }
    } else {
      func(callback.arg === undefined ? null : callback.arg);
    }
  }
}

var __ATPRERUN__  = []; // functions called before the runtime is initialized
var __ATINIT__    = []; // functions called during startup
var __ATMAIN__    = []; // functions called when main() is to be run
var __ATEXIT__    = []; // functions called during shutdown
var __ATPOSTRUN__ = []; // functions called after the main() is called

var runtimeInitialized = false;
var runtimeExited = false;


function preRun() {

  if (Module['preRun']) {
    if (typeof Module['preRun'] == 'function') Module['preRun'] = [Module['preRun']];
    while (Module['preRun'].length) {
      addOnPreRun(Module['preRun'].shift());
    }
  }

  callRuntimeCallbacks(__ATPRERUN__);
}

function initRuntime() {
  runtimeInitialized = true;
  
  callRuntimeCallbacks(__ATINIT__);
}

function preMain() {
  
  callRuntimeCallbacks(__ATMAIN__);
}

function exitRuntime() {
  runtimeExited = true;
}

function postRun() {

  if (Module['postRun']) {
    if (typeof Module['postRun'] == 'function') Module['postRun'] = [Module['postRun']];
    while (Module['postRun'].length) {
      addOnPostRun(Module['postRun'].shift());
    }
  }

  callRuntimeCallbacks(__ATPOSTRUN__);
}

function addOnPreRun(cb) {
  __ATPRERUN__.unshift(cb);
}

function addOnInit(cb) {
  __ATINIT__.unshift(cb);
}

function addOnPreMain(cb) {
  __ATMAIN__.unshift(cb);
}

function addOnExit(cb) {
}

function addOnPostRun(cb) {
  __ATPOSTRUN__.unshift(cb);
}

function unSign(value, bits, ignore) {
  if (value >= 0) {
    return value;
  }
  return bits <= 32 ? 2*Math.abs(1 << (bits-1)) + value // Need some trickery, since if bits == 32, we are right at the limit of the bits JS uses in bitshifts
                    : Math.pow(2, bits)         + value;
}
function reSign(value, bits, ignore) {
  if (value <= 0) {
    return value;
  }
  var half = bits <= 32 ? Math.abs(1 << (bits-1)) // abs is needed if bits == 32
                        : Math.pow(2, bits-1);
  if (value >= half && (bits <= 32 || value > half)) { // for huge values, we can hit the precision limit and always get true here. so don't do that
                                                       // but, in general there is no perfect solution here. With 64-bit ints, we get rounding and errors
                                                       // TODO: In i64 mode 1, resign the two parts separately and safely
    value = -2*half + value; // Cannot bitshift half, as it may be at the limit of the bits JS uses in bitshifts
  }
  return value;
}



var Math_abs = Math.abs;
var Math_cos = Math.cos;
var Math_sin = Math.sin;
var Math_tan = Math.tan;
var Math_acos = Math.acos;
var Math_asin = Math.asin;
var Math_atan = Math.atan;
var Math_atan2 = Math.atan2;
var Math_exp = Math.exp;
var Math_log = Math.log;
var Math_sqrt = Math.sqrt;
var Math_ceil = Math.ceil;
var Math_floor = Math.floor;
var Math_pow = Math.pow;
var Math_imul = Math.imul;
var Math_fround = Math.fround;
var Math_round = Math.round;
var Math_min = Math.min;
var Math_max = Math.max;
var Math_clz32 = Math.clz32;
var Math_trunc = Math.trunc;



// A counter of dependencies for calling run(). If we need to
// do asynchronous work before running, increment this and
// decrement it. Incrementing must happen in a place like
// Module.preRun (used by emcc to add file preloading).
// Note that you can add dependencies in preRun, even though
// it happens right before run - run will be postponed until
// the dependencies are met.
var runDependencies = 0;
var runDependencyWatcher = null;
var dependenciesFulfilled = null; // overridden to take different actions when all run dependencies are fulfilled

function getUniqueRunDependency(id) {
  return id;
}

function addRunDependency(id) {
  runDependencies++;

  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }

}

function removeRunDependency(id) {
  runDependencies--;

  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }

  if (runDependencies == 0) {
    if (runDependencyWatcher !== null) {
      clearInterval(runDependencyWatcher);
      runDependencyWatcher = null;
    }
    if (dependenciesFulfilled) {
      var callback = dependenciesFulfilled;
      dependenciesFulfilled = null;
      callback(); // can add another dependenciesFulfilled
    }
  }
}

Module["preloadedImages"] = {}; // maps url to image data
Module["preloadedAudios"] = {}; // maps url to audio data


var memoryInitializer = null;







// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// Prefix of data URIs emitted by SINGLE_FILE and related options.
var dataURIPrefix = 'data:application/octet-stream;base64,';

// Indicates whether filename is a base64 data URI.
function isDataURI(filename) {
  return String.prototype.startsWith ?
      filename.startsWith(dataURIPrefix) :
      filename.indexOf(dataURIPrefix) === 0;
}




var wasmBinaryFile = 'data:application/octet-stream;base64,AGFzbQEAAAABtgEZYAF/AGAEf39/fwBgBH9/f38Bf2ADf398AGAGf39/f39/AGABfwF/YAAAYAV/f39/fwBgAn9/AX9gA39/fwF/YAV/f39/fwF/YAZ/f39/f38Bf2AEf39/fABgAn9/AGANf39/f39/f39/f39/fwBgCH9/f39/f39/AGADf39/AGADf39/AXxgAAF/YAF9AX1gAAF9YAF9AX9gB39/f39/f38Bf2AFf39/f3wAYAd/f39/f39/AAL7BR0DZW52BWFib3J0AAADZW52C19fX3NldEVyck5vAAADZW52Fl9fZW1iaW5kX3JlZ2lzdGVyX2Jvb2wABwNlbnYXX19lbWJpbmRfcmVnaXN0ZXJfY2xhc3MADgNlbnYgX19lbWJpbmRfcmVnaXN0ZXJfY2xhc3NfZnVuY3Rpb24ADwNlbnYXX19lbWJpbmRfcmVnaXN0ZXJfZW12YWwADQNlbnYXX19lbWJpbmRfcmVnaXN0ZXJfZmxvYXQAEANlbnYaX19lbWJpbmRfcmVnaXN0ZXJfZnVuY3Rpb24ABANlbnYZX19lbWJpbmRfcmVnaXN0ZXJfaW50ZWdlcgAHA2Vudh1fX2VtYmluZF9yZWdpc3Rlcl9tZW1vcnlfdmlldwAQA2VudhxfX2VtYmluZF9yZWdpc3Rlcl9zdGRfc3RyaW5nAA0DZW52HV9fZW1iaW5kX3JlZ2lzdGVyX3N0ZF93c3RyaW5nABADZW52Fl9fZW1iaW5kX3JlZ2lzdGVyX3ZvaWQADQNlbnYKX19lbXZhbF9hcwARA2Vudg5fX2VtdmFsX2RlY3JlZgAAA2VudhRfX2VtdmFsX2dldF9wcm9wZXJ0eQAIA2Vudg5fX2VtdmFsX2luY3JlZgAAA2VudhNfX2VtdmFsX25ld19jc3RyaW5nAAUDZW52F19fZW12YWxfcnVuX2Rlc3RydWN0b3JzAAADZW52El9fZW12YWxfdGFrZV92YWx1ZQAIA2VudgZfYWJvcnQABgNlbnYZX2Vtc2NyaXB0ZW5fZ2V0X2hlYXBfc2l6ZQASA2VudhZfZW1zY3JpcHRlbl9tZW1jcHlfYmlnAAkDZW52F19lbXNjcmlwdGVuX3Jlc2l6ZV9oZWFwAAUDZW52F2Fib3J0T25DYW5ub3RHcm93TWVtb3J5AAUDZW52DF9fdGFibGVfYmFzZQN/AANlbnYORFlOQU1JQ1RPUF9QVFIDfwADZW52Bm1lbW9yeQIAgAIDZW52BXRhYmxlAXABSUkDfHsFBgUSAA0NEAAADQEAAgMBBgUFAAUEBgoMBwsFCAUTExMSEhQGEggFCBUGBgYGBgYGBgYGBgYGAAAAAAAABgYGBgYFBQgFAAkEBwEJEBABCAQHAQkJCAgIBAcBAQQHCQkFCAkCCgsWAA0MFwcEGAUICQIKCwYAAwwBBwQGEAJ/AUGwlAELfwFBsJTBAgsH/wQoEF9fZ3Jvd1dhc21NZW1vcnkAGRJfX1oxMmNyZWF0ZU1vZHVsZWkALStfX19lbWJpbmRfcmVnaXN0ZXJfbmF0aXZlX2FuZF9idWlsdGluX3R5cGVzAEMRX19fZXJybm9fbG9jYXRpb24APg5fX19nZXRUeXBlTmFtZQBbDF9faG9va19jeWNsZQAgC19faG9va19pbml0AB8KX19ob29rX29mZgAiCV9faG9va19vbgAhDF9faG9va19wYXJhbQAjEF9fb3NjX2JsX3Bhcl9pZHgANxBfX29zY19ibF9zYXdfaWR4ADgQX19vc2NfYmxfc3FyX2lkeAA5Dl9fb3NjX21jdV9oYXNoADoKX19vc2NfcmFuZAA7C19fb3NjX3doaXRlADwFX2ZyZWUAXwdfbWFsbG9jAF4HX21lbWNweQB3B19tZW1zZXQAeA1fb3NjX2FwaV9pbml0AD0FX3NicmsAeQpkeW5DYWxsX2lpAHoLZHluQ2FsbF9paWkAewxkeW5DYWxsX2lpaWkAfA1keW5DYWxsX2lpaWlpAH0OZHluQ2FsbF9paWlpaWkAfg9keW5DYWxsX2lpaWlpaWkAfwlkeW5DYWxsX3YAgAEKZHluQ2FsbF92aQCBAQxkeW5DYWxsX3ZpaWQAggENZHluQ2FsbF92aWlpZACDAQ1keW5DYWxsX3ZpaWlpAIQBDmR5bkNhbGxfdmlpaWlpAIUBD2R5bkNhbGxfdmlpaWlpaQCGARNlc3RhYmxpc2hTdGFja1NwYWNlAB4LZ2xvYmFsQ3RvcnMAGgpzdGFja0FsbG9jABsMc3RhY2tSZXN0b3JlAB0Jc3RhY2tTYXZlABwJaAEAIwALSYcBKisrKisrKisrKjSHAYcBhwGHAYgBNYkBYGxtigEmiwEwjAEzjQGOASIlIiIl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QQNyNgIEIA4kAiAAQQhqDwsgDiEAQcSKASgCAAR/QcyKASgCAAVBzIoBQYAgNgIAQciKAUGAIDYCAEHQigFBfzYCAEHUigFBfzYCAEHYigFBADYCAEGoigFBADYCAEHEigEgAEFwcUHYqtWqBXM2AgBBgCALIgAgA0EvaiIFaiIGQQAgAGsiB3EiBCADTQRAIA4kAkEADwtBpIoBKAIAIgAEQEGcigEoAgAiAiAEaiIKIAJNIAogAEtyBEAgDiQCQQAPCwsgA0EwaiEKAkACQEGoigEoAgBBBHEEQEEAIQEFAkACQAJAQYSHASgCACIARQ0AQayKASECA0ACQCACKAIAIg0gAE0EQCANIAIoAgRqIABLDQELIAIoAggiAg0BDAILCyAGIAFrIAdxIgFB/////wdJBEAgAkEEaiEGIAEQeSEAIAAgAigCACAGKAIAakcNAiAAQX9HDQUFQQAhAQsMAgtBABB5IgBBf0YEf0EABUGcigEoAgAiBiAAQciKASgCACIBQX9qIgJqQQAgAWtxIABrQQAgACACcRsgBGoiAWohAiABQf////8HSSABIANLcQR/QaSKASgCACIHBEAgAiAGTSACIAdLcgRAQQAhAQwFCwsgACABEHkiAkYNBSACIQAMAgVBAAsLIQEMAQsgAEF/RyABQf////8HSXEgCiABS3FFBEAgAEF/RgRAQQAhAQwCBQwECwALQcyKASgCACICIAUgAWtqQQAgAmtxIgJB/////wdPDQJBACABayEFIAIQeUF/RgR/IAUQeRpBAAUgASACaiEBDAMLIQELQaiKAUGoigEoAgBBBHI2AgALIARB/////wdJBEAgBBB5IQBBABB5IgIgAGsiBSADQShqSyEEIAUgASAEGyEBIARBAXMgAEF/RnIgAEF/RyACQX9HcSAAIAJJcUEBc3JFDQELDAELQZyKAUGcigEoAgAgAWoiAjYCACACQaCKASgCAEsEQEGgigEgAjYCAAtBhIcBKAIAIgUEQAJAQayKASECAkACQANAIAIoAgAiBCACKAIEIgZqIABGDQEgAigCCCICDQALDAELIAJBBGohByACKAIMQQhxRQRAIAQgBU0gACAFS3EEQCAHIAEgBmo2AgAgBUEAIAVBCGoiAGtBB3FBACAAQQdxGyICaiEAQfiGASgCACABaiIEIAJrIQFBhIcB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4AUAAAQAAAAFAAAABgAAAAcAAAABAAAAAgAAAAEAAAADAAAAAAAAAAgGAAAEAAAACAAAAAYAAAAHAAAAAQAAAAMAAAACAAAABAAAAAAAAABYBgAABAAAAAkAAAAGAAAABwAAAAIAAAAAAAAAKAYAAAQAAAAKAAAABgAAAAcAAAADAAAAAAAAANgGAAAEAAAACwAAAAYAAAAHAAAAAQAAAAQAAAADAAAABQAAAE40S09SRzE0TG9ndWVQcm9jZXNzb3JFAE40S09SRzE1TG9ndWVPc2NpbGxhdG9yRQBMb2d1ZVByb2Nlc3NvcgBpaQB2aQBMb2d1ZU9zY2lsbGF0b3IATG9ndWVFZmZlY3QAUEtONEtPUkcxMUxvZ3VlRWZmZWN0RQBQTjRLT1JHMTFMb2d1ZUVmZmVjdEUATjRLT1JHMTFMb2d1ZUVmZmVjdEUAUEtONEtPUkcxNUxvZ3VlT3NjaWxsYXRvckUAUE40S09SRzE1TG9ndWVPc2NpbGxhdG9yRQBQS040S09SRzE0TG9ndWVQcm9jZXNzb3JFAFBONEtPUkcxNExvZ3VlUHJvY2Vzc29yRQBzZXQATlN0M19fMjEyYmFzaWNfc3RyaW5nSWNOU18xMWNoYXJfdHJhaXRzSWNFRU5TXzlhbGxvY2F0b3JJY0VFRUUATlN0M19fMjIxX19iYXNpY19zdHJpbmdfY29tbW9uSUxiMUVFRQBOM1dBQjlQcm9jZXNzb3JFAFByb2Nlc3NvcgB2AGluaXQAaWlpaWlpAHNldFBhcmFtAHZpaWlkAHByb2Nlc3MAdmlpaWlpAG9ubWVzc2FnZQBpaWlpaWlpAGdldEluc3RhbmNlAGlpaQBOMTBlbXNjcmlwdGVuM3ZhbEUAUEtOM1dBQjlQcm9jZXNzb3JFAFBOM1dBQjlQcm9jZXNzb3JFAGxlbmd0aAB2b2lkAGJvb2wAY2hhcgBzaWduZWQgY2hhcgB1bnNpZ25lZCBjaGFyAHNob3J0AHVuc2lnbmVkIHNob3J0AGludAB1bnNpZ25lZCBpbnQAbG9uZwB1bnNpZ25lZCBsb25nAGZsb2F0AGRvdWJsZQBzdGQ6OnN0cmluZwBzdGQ6OmJhc2ljX3N0cmluZzx1bnNpZ25lZCBjaGFyPgBzdGQ6OndzdHJpbmcAZW1zY3JpcHRlbjo6dmFsAGVtc2NyaXB0ZW46Om1lbW9yeV92aWV3PGNoYXI+AGVtc2NyaXB0ZW46Om1lbW9yeV92aWV3PHNpZ25lZCBjaGFyPgBlbXNjcmlwdGVuOjptZW1vcnlfdmlldzx1bnNpZ25lZCBjaGFyPgBlbXNjcmlwdGVuOjptZW1vcnlfdmlldzxzaG9ydD4AZW1zY3JpcHRlbjo6bWVtb3J5X3ZpZXc8dW5zaWduZWQgc2hvcnQ+AGVtc2NyaXB0ZW46Om1lbW9yeV92aWV3PGludD4AZW1zY3JpcHRlbjo6bWVtb3J5X3ZpZXc8dW5zaWduZWQgaW50PgBlbXNjcmlwdGVuOjptZW1vcnlfdmlldzxsb25nPgBlbXNjcmlwdGVuOjptZW1vcnlfdmlldzx1bnNpZ25lZCBsb25nPgBlbXNjcmlwdGVuOjptZW1vcnlfdmlldzxpbnQ4X3Q+AGVtc2NyaXB0ZW46Om1lbW9yeV92aWV3PHVpbnQ4X3Q+AGVtc2NyaXB0ZW46Om1lbW9yeV92aWV3PGludDE2X3Q+AGVtc2NyaXB0ZW46Om1lbW9yeV92aWV3PHVpbnQxNl90PgBlbXNjcmlwdGVuOjptZW1vcnlfdmlldzxpbnQzMl90PgBlbXNjcmlwdGVuOjptZW1vcnlfdmlldzx1aW50MzJfdD4AZW1zY3JpcHRlbjo6bWVtb3J5X3ZpZXc8ZmxvYXQ+AGVtc2NyaXB0ZW46Om1lbW9yeV92aWV3PGRvdWJsZT4AZW1zY3JpcHRlbjo6bWVtb3J5X3ZpZXc8bG9uZyBkb3VibGU+AE4xMGVtc2NyaXB0ZW4xMW1lbW9yeV92aWV3SWVFRQBOMTBlbXNjcmlwdGVuMTFtZW1vcnlfdmlld0lkRUUATjEwZW1zY3JpcHRlbjExbWVtb3J5X3ZpZXdJZkVFAE4xMGVtc2NyaXB0ZW4xMW1lbW9yeV92aWV3SW1FRQBOMTBlbXNjcmlwdGVuMTFtZW1vcnlfdmlld0lsRUUATjEwZW1zY3JpcHRlbjExbWVtb3J5X3ZpZXdJakVFAE4xMGVtc2NyaXB0ZW4xMW1lbW9yeV92aWV3SWlFRQBOMTBlbXNjcmlwdGVuMTFtZW1vcnlfdmlld0l0RUUATjEwZW1zY3JpcHRlbjExbWVtb3J5X3ZpZXdJc0VFAE4xMGVtc2NyaXB0ZW4xMW1lbW9yeV92aWV3SWhFRQBOMTBlbXNjcmlwdGVuMTFtZW1vcnlfdmlld0lhRUUATjEwZW1zY3JpcHRlbjExbWVtb3J5X3ZpZXdJY0VFAE5TdDNfXzIxMmJhc2ljX3N0cmluZ0l3TlNfMTFjaGFyX3RyYWl0c0l3RUVOU185YWxsb2NhdG9ySXdFRUVFAE5TdDNfXzIxMmJhc2ljX3N0cmluZ0loTlNfMTFjaGFyX3RyYWl0c0loRUVOU185YWxsb2NhdG9ySWhFRUVFAE4xMF9fY3h4YWJpdjExNl9fc2hpbV90eXBlX2luZm9FAFN0OXR5cGVfaW5mbwBOMTBfX2N4eGFiaXYxMjBfX3NpX2NsYXNzX3R5cGVfaW5mb0UATjEwX19jeHhhYml2MTE3X19jbGFzc190eXBlX2luZm9FAE4xMF9fY3h4YWJpdjExN19fcGJhc2VfdHlwZV9pbmZvRQBOMTBfX2N4eGFiaXYxMTlfX3BvaW50ZXJfdHlwZV9pbmZvRQBOMTBfX2N4eGFiaXYxMjBfX2Z1bmN0aW9uX3R5cGVfaW5mb0UATjEwX19jeHhhYml2MTI5X19wb2ludGVyX3RvX21lbWJlcl90eXBlX2luZm9FAE4xMF9fY3h4YWJpdjEyM19fZnVuZGFtZW50YWxfdHlwZV9pbmZvRQB2AERuAGIAYwBoAGEAcwB0AGkAagBsAG0AZgBkAE4xMF9fY3h4YWJpdjEyMV9fdm1pX2NsYXNzX3R5cGVfaW5mb0UApCwEbmFtZQGcLJQBAAVhYm9ydAELX19fc2V0RXJyTm8CFl9fZW1iaW5kX3JlZ2lzdGVyX2Jvb2wDF19fZW1iaW5kX3JlZ2lzdGVyX2NsYXNzBCBfX2VtYmluZF9yZWdpc3Rlcl9jbGFzc19mdW5jdGlvbgUXX19lbWJpbmRfcmVnaXN0ZXJfZW12YWwGF19fZW1iaW5kX3JlZ2lzdGVyX2Zsb2F0BxpfX2VtYmluZF9yZWdpc3Rlcl9mdW5jdGlvbggZX19lbWJpbmRfcmVnaXN0ZXJfaW50ZWdlcgkdX19lbWJpbmRfcmVnaXN0ZXJfbWVtb3J5X3ZpZXcKHF9fZW1iaW5kX3JlZ2lzdGVyX3N0ZF9zdHJpbmcLHV9fZW1iaW5kX3JlZ2lzdGVyX3N0ZF93c3RyaW5nDBZfX2VtYmluZF9yZWdpc3Rlcl92b2lkDQpfX2VtdmFsX2FzDg5fX2VtdmFsX2RlY3JlZg8UX19lbXZhbF9nZXRfcHJvcGVydHkQDl9fZW12YWxfaW5jcmVmERNfX2VtdmFsX25ld19jc3RyaW5nEhdfX2VtdmFsX3J1bl9kZXN0cnVjdG9ycxMSX19lbXZhbF90YWtlX3ZhbHVlFAZfYWJvcnQVGV9lbXNjcmlwdGVuX2dldF9oZWFwX3NpemUWFl9lbXNjcmlwdGVuX21lbWNweV9iaWcXF19lbXNjcmlwdGVuX3Jlc2l6ZV9oZWFwGBdhYm9ydE9uQ2Fubm90R3Jvd01lbW9yeRkQX19ncm93V2FzbU1lbW9yeRoLZ2xvYmFsQ3RvcnMbCnN0YWNrQWxsb2McCXN0YWNrU2F2ZR0Mc3RhY2tSZXN0b3JlHhNlc3RhYmxpc2hTdGFja1NwYWNlHwtfX2hvb2tfaW5pdCAMX19ob29rX2N5Y2xlIQlfX2hvb2tfb24iCl9faG9va19vZmYjDF9faG9va19wYXJhbSQmX19aTjRLT1JHMTRMb2d1ZVByb2Nlc3NvcjdzZXRQcm9wRWpQdmolHl9fWk40S09SRzE1TG9ndWVPc2NpbGxhdG9yRDBFdiY0X19aTjRLT1JHMTVMb2d1ZU9zY2lsbGF0b3I0aW5pdEVqak4xMGVtc2NyaXB0ZW4zdmFsRScmX19aTjRLT1JHMTVMb2d1ZU9zY2lsbGF0b3I4c2V0UGFyYW1FamQoO19fWk40S09SRzE1TG9ndWVPc2NpbGxhdG9yN3Byb2Nlc3NFTjEwZW1zY3JpcHRlbjN2YWxFUzJfUzJfKSFfX0dMT0JBTF9fc3ViX0lfbG9ndWVfd3JhcHBlcl9jcHAqSF9fWk4xMGVtc2NyaXB0ZW44aW50ZXJuYWwxM2dldEFjdHVhbFR5cGVJTjRLT1JHMTRMb2d1ZVByb2Nlc3NvckVFRVBLdlBUXytbX19aTjEwZW1zY3JpcHRlbjRiYXNlSU4zV0FCOVByb2Nlc3NvckVFMTRjb252ZXJ0UG9pbnRlcklONEtPUkcxNExvZ3VlUHJvY2Vzc29yRVMyX0VFUFQwX1BUXyxHX19aTjEwZW1zY3JpcHRlbjhpbnRlcm5hbDE0cmF3X2Rlc3RydWN0b3JJTjRLT1JHMTRMb2d1ZVByb2Nlc3NvckVFRXZQVF8tEl9fWjEyY3JlYXRlTW9kdWxlaS4yX19aTjNXQUI5UHJvY2Vzc29yOW9ubWVzc2FnZUVOMTBlbXNjcmlwdGVuM3ZhbEVqamovNF9fWk40MkVtc2NyaXB0ZW5CaW5kaW5nSW5pdGlhbGl6ZXJfV0FCX1Byb2Nlc3NvckMyRXYwdF9fWk4xMGVtc2NyaXB0ZW44aW50ZXJuYWwxM01ldGhvZEludm9rZXJJTU4zV0FCOVByb2Nlc3NvckVGYmpqTlNfM3ZhbEVFYlBTM19KampTNF9FRTZpbnZva2VFUktTNl9TN19qalBOUzBfN19FTV9WQUxFMVtfX1pOMTBlbXNjcmlwdGVuOGludGVybmFsMTNNZXRob2RJbnZva2VySU1OM1dBQjlQcm9jZXNzb3JFRnZqZEV2UFMzX0pqZEVFNmludm9rZUVSS1M1X1M2X2pkMoABX19aTjEwZW1zY3JpcHRlbjhpbnRlcm5hbDEzTWV0aG9kSW52b2tlcklNTjNXQUI5UHJvY2Vzc29yRUZ2TlNfM3ZhbEVTNF9TNF9FdlBTM19KUzRfUzRfUzRfRUU2aW52b2tlRVJLUzZfUzdfUE5TMF83X0VNX1ZBTEVTQ19TQ18ze19fWk4xMGVtc2NyaXB0ZW44aW50ZXJuYWwxM01ldGhvZEludm9rZXJJTU4zV0FCOVByb2Nlc3NvckVGTlNfM3ZhbEVTNF9qampFUzRfUFMzX0pTNF9qampFRTZpbnZva2VFUktTNl9TN19QTlMwXzdfRU1fVkFMRWpqajQRX19aMTFnZXRJbnN0YW5jZWk1R19fWk4xMGVtc2NyaXB0ZW44aW50ZXJuYWw3SW52b2tlcklQTjNXQUI5UHJvY2Vzc29yRUppRUU2aW52b2tlRVBGUzRfaUVpNjBfX1pOM1dBQjlQcm9jZXNzb3I5Z2V0QnVmZmVyRU4xMGVtc2NyaXB0ZW4zdmFsRWk3EF9fb3NjX2JsX3Bhcl9pZHg4EF9fb3NjX2JsX3Nhd19pZHg5EF9fb3NjX2JsX3Nxcl9pZHg6Dl9fb3NjX21jdV9oYXNoOwpfX29zY19yYW5kPAtfX29zY193aGl0ZT0NX29zY19hcGlfaW5pdD4RX19fZXJybm9fbG9jYXRpb24/B19zdHJjbXBAB19zdHJsZW5BB19tZW1jbXBCDl9fX2ZwY2xhc3NpZnlmQytfX19lbWJpbmRfcmVnaXN0ZXJfbmF0aXZlX2FuZF9idWlsdGluX3R5cGVzRCxfX1pOMTJfR0xPQkFMX19OXzExNnJlZ2lzdGVyX2ludGVnZXJJY0VFdlBLY0UsX19aTjEyX0dMT0JBTF9fTl8xMTZyZWdpc3Rlcl9pbnRlZ2VySWFFRXZQS2NGLF9fWk4xMl9HTE9CQUxfX05fMTE2cmVnaXN0ZXJfaW50ZWdlckloRUV2UEtjRyxfX1pOMTJfR0xPQkFMX19OXzExNnJlZ2lzdGVyX2ludGVnZXJJc0VFdlBLY0gsX19aTjEyX0dMT0JBTF9fTl8xMTZyZWdpc3Rlcl9pbnRlZ2VySXRFRXZQS2NJLF9fWk4xMl9HTE9CQUxfX05fMTE2cmVnaXN0ZXJfaW50ZWdlcklpRUV2UEtjSixfX1pOMTJfR0xPQkFMX19OXzExNnJlZ2lzdGVyX2ludGVnZXJJakVFdlBLY0ssX19aTjEyX0dMT0JBTF9fTl8xMTZyZWdpc3Rlcl9pbnRlZ2VySWxFRXZQS2NMLF9fWk4xMl9HTE9CQUxfX05fMTE2cmVnaXN0ZXJfaW50ZWdlckltRUV2UEtjTSpfX1pOMTJfR0xPQkFMX19OXzExNHJlZ2lzdGVyX2Zsb2F0SWZFRXZQS2NOKl9fWk4xMl9HTE9CQUxfX05fMTE0cmVnaXN0ZXJfZmxvYXRJZEVFdlBLY08wX19aTjEyX0dMT0JBTF9fTl8xMjByZWdpc3Rlcl9tZW1vcnlfdmlld0ljRUV2UEtjUDBfX1pOMTJfR0xPQkFMX19OXzEyMHJlZ2lzdGVyX21lbW9yeV92aWV3SWFFRXZQS2NRMF9fWk4xMl9HTE9CQUxfX05fMTIwcmVnaXN0ZXJfbWVtb3J5X3ZpZXdJaEVFdlBLY1IwX19aTjEyX0dMT0JBTF9fTl8xMjByZWdpc3Rlcl9tZW1vcnlfdmlld0lzRUV2UEtjUzBfX1pOMTJfR0xPQkFMX19OXzEyMHJlZ2lzdGVyX21lbW9yeV92aWV3SXRFRXZQS2NUMF9fWk4xMl9HTE9CQUxfX05fMTIwcmVnaXN0ZXJfbWVtb3J5X3ZpZXdJaUVFdlBLY1UwX19aTjEyX0dMT0JBTF9fTl8xMjByZWdpc3Rlcl9tZW1vcnlfdmlld0lqRUV2UEtjVjBfX1pOMTJfR0xPQkFMX19OXzEyMHJlZ2lzdGVyX21lbW9yeV92aWV3SWxFRXZQS2NXMF9fWk4xMl9HTE9CQUxfX05fMTIwcmVnaXN0ZXJfbWVtb3J5X3ZpZXdJbUVFdlBLY1gwX19aTjEyX0dMT0JBTF9fTl8xMjByZWdpc3Rlcl9tZW1vcnlfdmlld0lmRUV2UEtjWTBfX1pOMTJfR0xPQkFMX19OXzEyMHJlZ2lzdGVyX21lbW9yeV92aWV3SWRFRXZQS2NaMF9fWk4xMl9HTE9CQUxfX05fMTIwcmVnaXN0ZXJfbWVtb3J5X3ZpZXdJZUVFdlBLY1sOX19fZ2V0VHlwZU5hbWVcBl9fWm53bV1QX19aTktTdDNfXzIxMmJhc2ljX3N0cmluZ0ljTlNfMTFjaGFyX3RyYWl0c0ljRUVOU185YWxsb2NhdG9ySWNFRUU3Y29tcGFyZUVtbVBLY21eB19tYWxsb2NfBV9mcmVlYEpfX1pOSzEwX19jeHhhYml2MTE3X19jbGFzc190eXBlX2luZm85Y2FuX2NhdGNoRVBLTlNfMTZfX3NoaW1fdHlwZV9pbmZvRVJQdmFZX19aTksxMF9fY3h4YWJpdjExN19fY2xhc3NfdHlwZV9pbmZvMTZzZWFyY2hfYWJvdmVfZHN0RVBOU18xOV9fZHluYW1pY19jYXN0X2luZm9FUEt2UzRfaWJiVl9fWk5LMTBfX2N4eGFiaXYxMTdfX2NsYXNzX3R5cGVfaW5mbzE2c2VhcmNoX2JlbG93X2RzdEVQTlNfMTlfX2R5bmFtaWNfY2FzdF9pbmZvRVBLdmliY19fX1pOSzEwX19jeHhhYml2MTE3X19jbGFzc190eXBlX2luZm8yN2hhc191bmFtYmlndW91c19wdWJsaWNfYmFzZUVQTlNfMTlfX2R5bmFtaWNfY2FzdF9pbmZvRVB2aWQfX19aTDhpc19lcXVhbFBLU3Q5dHlwZV9pbmZvUzFfYmVcX19aTksxMF9fY3h4YWJpdjExN19fY2xhc3NfdHlwZV9pbmZvMjRwcm9jZXNzX2ZvdW5kX2Jhc2VfY2xhc3NFUE5TXzE5X19keW5hbWljX2Nhc3RfaW5mb0VQdmlmYl9fWk5LMTBfX2N4eGFiaXYxMTdfX2NsYXNzX3R5cGVfaW5mbzI5cHJvY2Vzc19zdGF0aWNfdHlwZV9iZWxvd19kc3RFUE5TXzE5X19keW5hbWljX2Nhc3RfaW5mb0VQS3ZpZ2VfX1pOSzEwX19jeHhhYml2MTE3X19jbGFzc190eXBlX2luZm8yOXByb2Nlc3Nfc3RhdGljX3R5cGVfYWJvdmVfZHN0RVBOU18xOV9fZHluYW1pY19jYXN0X2luZm9FUEt2UzRfaWgPX19fZHluYW1pY19jYXN0aVxfX1pOSzEwX19jeHhhYml2MTIwX19zaV9jbGFzc190eXBlX2luZm8xNnNlYXJjaF9hYm92ZV9kc3RFUE5TXzE5X19keW5hbWljX2Nhc3RfaW5mb0VQS3ZTNF9pYmpZX19aTksxMF9fY3h4YWJpdjEyMF9fc2lfY2xhc3NfdHlwZV9pbmZvMTZzZWFyY2hfYmVsb3dfZHN0RVBOU18xOV9fZHluYW1pY19jYXN0X2luZm9FUEt2aWJrYl9fWk5LMTBfX2N4eGFiaXYxMjBfX3NpX2NsYXNzX3R5cGVfaW5mbzI3aGFzX3VuYW1iaWd1b3VzX3B1YmxpY19iYXNlRVBOU18xOV9fZHluYW1pY19jYXN0X2luZm9FUHZpbFBfX1pOSzEwX19jeHhhYml2MTIzX19mdW5kYW1lbnRhbF90eXBlX2luZm85Y2FuX2NhdGNoRVBLTlNfMTZfX3NoaW1fdHlwZV9pbmZvRVJQdm1MX19aTksxMF9fY3h4YWJpdjExOV9fcG9pbnRlcl90eXBlX2luZm85Y2FuX2NhdGNoRVBLTlNfMTZfX3NoaW1fdHlwZV9pbmZvRVJQdm5KX19aTksxMF9fY3h4YWJpdjExN19fcGJhc2VfdHlwZV9pbmZvOWNhbl9jYXRjaEVQS05TXzE2X19zaGltX3R5cGVfaW5mb0VSUHZvUV9fWk5LMTBfX2N4eGFiaXYxMTlfX3BvaW50ZXJfdHlwZV9pbmZvMTZjYW5fY2F0Y2hfbmVzdGVkRVBLTlNfMTZfX3NoaW1fdHlwZV9pbmZvRXBbX19aTksxMF9fY3h4YWJpdjEyOV9fcG9pbnRlcl90b19tZW1iZXJfdHlwZV9pbmZvMTZjYW5fY2F0Y2hfbmVzdGVkRVBLTlNfMTZfX3NoaW1fdHlwZV9pbmZvRXFdX19aTksxMF9fY3h4YWJpdjEyMV9fdm1pX2NsYXNzX3R5cGVfaW5mbzE2c2VhcmNoX2Fib3ZlX2RzdEVQTlNfMTlfX2R5bmFtaWNfY2FzdF9pbmZvRVBLdlM0X2liclpfX1pOSzEwX19jeHhhYml2MTIxX192bWlfY2xhc3NfdHlwZV9pbmZvMTZzZWFyY2hfYmVsb3dfZHN0RVBOU18xOV9fZHluYW1pY19jYXN0X2luZm9FUEt2aWJzY19fWk5LMTBfX2N4eGFiaXYxMjFfX3ZtaV9jbGFzc190eXBlX2luZm8yN2hhc191bmFtYmlndW91c19wdWJsaWNfYmFzZUVQTlNfMTlfX2R5bmFtaWNfY2FzdF9pbmZvRVB2aXRkX19aTksxMF9fY3h4YWJpdjEyMl9fYmFzZV9jbGFzc190eXBlX2luZm8yN2hhc191bmFtYmlndW91c19wdWJsaWNfYmFzZUVQTlNfMTlfX2R5bmFtaWNfY2FzdF9pbmZvRVB2aXVeX19aTksxMF9fY3h4YWJpdjEyMl9fYmFzZV9jbGFzc190eXBlX2luZm8xNnNlYXJjaF9hYm92ZV9kc3RFUE5TXzE5X19keW5hbWljX2Nhc3RfaW5mb0VQS3ZTNF9pYnZbX19aTksxMF9fY3h4YWJpdjEyMl9fYmFzZV9jbGFzc190eXBlX2luZm8xNnNlYXJjaF9iZWxvd19kc3RFUE5TXzE5X19keW5hbWljX2Nhc3RfaW5mb0VQS3ZpYncHX21lbWNweXgHX21lbXNldHkFX3Nicmt6CmR5bkNhbGxfaWl7C2R5bkNhbGxfaWlpfAxkeW5DYWxsX2lpaWl9DWR5bkNhbGxfaWlpaWl+DmR5bkNhbGxfaWlpaWlpfw9keW5DYWxsX2lpaWlpaWmAAQlkeW5DYWxsX3aBAQpkeW5DYWxsX3ZpggEMZHluQ2FsbF92aWlkgwENZHluQ2FsbF92aWlpZIQBDWR5bkNhbGxfdmlpaWmFAQ5keW5DYWxsX3ZpaWlpaYYBD2R5bkNhbGxfdmlpaWlpaYcBAmIwiAECYjGJAQJiMooBAmIziwECYjSMAQJiNY0BAmI2jgECYjePAQJiOJABAmI5kQEDYjEwkgEDYjExkwEDYjEyADMQc291cmNlTWFwcGluZ1VSTCFodHRwOi8vbG9jYWxob3N0OjgwODIvcGQud2FzbS5tYXA=';
if (!isDataURI(wasmBinaryFile)) {
  wasmBinaryFile = locateFile(wasmBinaryFile);
}

function getBinary() {
  try {
    if (wasmBinary) {
      return new Uint8Array(wasmBinary);
    }

    var binary = tryParseAsDataURI(wasmBinaryFile);
    if (binary) {
      return binary;
    }
    if (readBinary) {
      return readBinary(wasmBinaryFile);
    } else {
      throw "sync fetching of the wasm failed: you can preload it to Module['wasmBinary'] manually, or emcc.py will do that for you when generating HTML (but not JS)";
    }
  }
  catch (err) {
    abort(err);
  }
}

function getBinaryPromise() {
  // if we don't have the binary yet, and have the Fetch api, use that
  // in some environments, like Electron's render process, Fetch api may be present, but have a different context than expected, let's only use it on the Web
  if (!wasmBinary && (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) && typeof fetch === 'function') {
    return fetch(wasmBinaryFile, { credentials: 'same-origin' }).then(function(response) {
      if (!response['ok']) {
        throw "failed to load wasm binary file at '" + wasmBinaryFile + "'";
      }
      return response['arrayBuffer']();
    }).catch(function () {
      return getBinary();
    });
  }
  // Otherwise, getBinary should be able to get it synchronously
  return new Promise(function(resolve, reject) {
    resolve(getBinary());
  });
}



// Create the wasm instance.
// Receives the wasm imports, returns the exports.
function createWasm(env) {
  // prepare imports
  var info = {
    'env': env,
    'wasi_unstable': env
    ,
    'global': {
      'NaN': NaN,
      'Infinity': Infinity
    },
    'global.Math': Math,
    'asm2wasm': asm2wasmImports
  };
  // Load the wasm module and create an instance of using native support in the JS engine.
  // handle a generated wasm instance, receiving its exports and
  // performing other necessary setup
  function receiveInstance(instance, module) {
    var exports = instance.exports;
    Module['asm'] = exports;
    removeRunDependency('wasm-instantiate');
  }
   // we can't run yet (except in a pthread, where we have a custom sync instantiator)
  addRunDependency('wasm-instantiate');


  function receiveInstantiatedSource(output) {
    // 'output' is a WebAssemblyInstantiatedSource object which has both the module and instance.
    // receiveInstance() will swap in the exports (to Module.asm) so they can be called
      // TODO: Due to Closure regression https://github.com/google/closure-compiler/issues/3193, the above line no longer optimizes out down to the following line.
      // When the regression is fixed, can restore the above USE_PTHREADS-enabled path.
    receiveInstance(output['instance']);
  }


  function instantiateArrayBuffer(receiver) {
    return getBinaryPromise().then(function(binary) {
      return WebAssembly.instantiate(binary, info);
    }).then(receiver, function(reason) {
      err('failed to asynchronously prepare wasm: ' + reason);
      abort(reason);
    });
  }

  // Prefer streaming instantiation if available.
  function instantiateSync() {
    var instance;
    var module;
    var binary;
    try {
      binary = getBinary();
      module = new WebAssembly.Module(binary);
      instance = new WebAssembly.Instance(module, info);
    } catch (e) {
      var str = e.toString();
      err('failed to compile wasm module: ' + str);
      if (str.indexOf('imported Memory') >= 0 ||
          str.indexOf('memory import') >= 0) {
        err('Memory size incompatibility issues may be due to changing TOTAL_MEMORY at runtime to something too large. Use ALLOW_MEMORY_GROWTH to allow any size memory (and also make sure not to set TOTAL_MEMORY at runtime to something smaller than it was at compile time).');
      }
      throw e;
    }
    receiveInstance(instance, module);
  }
  // User shell pages can write their own Module.instantiateWasm = function(imports, successCallback) callback
  // to manually instantiate the Wasm module themselves. This allows pages to run the instantiation parallel
  // to any other async startup actions they are performing.
  if (Module['instantiateWasm']) {
    try {
      var exports = Module['instantiateWasm'](info, receiveInstance);
      return exports;
    } catch(e) {
      err('Module.instantiateWasm callback failed with error: ' + e);
      return false;
    }
  }

  instantiateSync();
  return Module['asm']; // exports were assigned here
}

// Provide an "asm.js function" for the application, called to "link" the asm.js module. We instantiate
// the wasm module at that time, and it receives imports and provides exports and so forth, the app
// doesn't need to care that it is wasm or asm.js.

Module['asm'] = function(global, env, providedBuffer) {
  // memory was already allocated (so js could use the buffer)
  env['memory'] = wasmMemory
  ;
  // import table
  env['table'] = wasmTable = new WebAssembly.Table({
    'initial': 73,
    'maximum': 73,
    'element': 'anyfunc'
  });
  // With the wasm backend __memory_base and __table_base and only needed for
  // relocatable output.
  env['__memory_base'] = 1024; // tell the memory segments where to place themselves
  // table starts at 0 by default (even in dynamic linking, for the main module)
  env['__table_base'] = 0;

  var exports = createWasm(env);
  return exports;
};

// Globals used by JS i64 conversions
var tempDouble;
var tempI64;

// === Body ===

var ASM_CONSTS = [];





// STATICTOP = STATIC_BASE + 17968;
/* global initializers */  __ATINIT__.push({ func: function() { globalCtors() } });








/* no memory initializer */
var tempDoublePtr = 18976

function copyTempFloat(ptr) { // functions, because inlining this code increases code size too much
  HEAP8[tempDoublePtr] = HEAP8[ptr];
  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];
  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];
  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];
}

function copyTempDouble(ptr) {
  HEAP8[tempDoublePtr] = HEAP8[ptr];
  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];
  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];
  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];
  HEAP8[tempDoublePtr+4] = HEAP8[ptr+4];
  HEAP8[tempDoublePtr+5] = HEAP8[ptr+5];
  HEAP8[tempDoublePtr+6] = HEAP8[ptr+6];
  HEAP8[tempDoublePtr+7] = HEAP8[ptr+7];
}

// {{PRE_LIBRARY}}


  function demangle(func) {
      return func;
    }

  function demangleAll(text) {
      var regex =
        /\b__Z[\w\d_]+/g;
      return text.replace(regex,
        function(x) {
          var y = demangle(x);
          return x === y ? x : (y + ' [' + x + ']');
        });
    }

  function jsStackTrace() {
      var err = new Error();
      if (!err.stack) {
        // IE10+ special cases: It does have callstack info, but it is only populated if an Error object is thrown,
        // so try that as a special-case.
        try {
          throw new Error(0);
        } catch(e) {
          err = e;
        }
        if (!err.stack) {
          return '(no stack trace available)';
        }
      }
      return err.stack.toString();
    }

  function stackTrace() {
      var js = jsStackTrace();
      if (Module['extraStackTrace']) js += '\n' + Module['extraStackTrace']();
      return demangleAll(js);
    }

  function ___gxx_personality_v0() {
    }

  
  function getShiftFromSize(size) {
      switch (size) {
          case 1: return 0;
          case 2: return 1;
          case 4: return 2;
          case 8: return 3;
          default:
              throw new TypeError('Unknown type size: ' + size);
      }
    }
  
  
  
  function embind_init_charCodes() {
      var codes = new Array(256);
      for (var i = 0; i < 256; ++i) {
          codes[i] = String.fromCharCode(i);
      }
      embind_charCodes = codes;
    }var embind_charCodes=undefined;function readLatin1String(ptr) {
      var ret = "";
      var c = ptr;
      while (HEAPU8[c]) {
          ret += embind_charCodes[HEAPU8[c++]];
      }
      return ret;
    }
  
  
  var awaitingDependencies={};
  
  var registeredTypes={};
  
  var typeDependencies={};
  
  
  
  
  
  
  var char_0=48;
  
  var char_9=57;function makeLegalFunctionName(name) {
      if (undefined === name) {
          return '_unknown';
      }
      name = name.replace(/[^a-zA-Z0-9_]/g, '$');
      var f = name.charCodeAt(0);
      if (f >= char_0 && f <= char_9) {
          return '_' + name;
      } else {
          return name;
      }
    }function createNamedFunction(name, body) {
      name = makeLegalFunctionName(name);
      /*jshint evil:true*/
      return new Function(
          "body",
          "return function " + name + "() {\n" +
          "    \"use strict\";" +
          "    return body.apply(this, arguments);\n" +
          "};\n"
      )(body);
    }function extendError(baseErrorType, errorName) {
      var errorClass = createNamedFunction(errorName, function(message) {
          this.name = errorName;
          this.message = message;
  
          var stack = (new Error(message)).stack;
          if (stack !== undefined) {
              this.stack = this.toString() + '\n' +
                  stack.replace(/^Error(:[^\n]*)?\n/, '');
          }
      });
      errorClass.prototype = Object.create(baseErrorType.prototype);
      errorClass.prototype.constructor = errorClass;
      errorClass.prototype.toString = function() {
          if (this.message === undefined) {
              return this.name;
          } else {
              return this.name + ': ' + this.message;
          }
      };
  
      return errorClass;
    }var BindingError=undefined;function throwBindingError(message) {
      throw new BindingError(message);
    }
  
  
  
  var InternalError=undefined;function throwInternalError(message) {
      throw new InternalError(message);
    }function whenDependentTypesAreResolved(myTypes, dependentTypes, getTypeConverters) {
      myTypes.forEach(function(type) {
          typeDependencies[type] = dependentTypes;
      });
  
      function onComplete(typeConverters) {
          var myTypeConverters = getTypeConverters(typeConverters);
          if (myTypeConverters.length !== myTypes.length) {
              throwInternalError('Mismatched type converter count');
          }
          for (var i = 0; i < myTypes.length; ++i) {
              registerType(myTypes[i], myTypeConverters[i]);
          }
      }
  
      var typeConverters = new Array(dependentTypes.length);
      var unregisteredTypes = [];
      var registered = 0;
      dependentTypes.forEach(function(dt, i) {
          if (registeredTypes.hasOwnProperty(dt)) {
              typeConverters[i] = registeredTypes[dt];
          } else {
              unregisteredTypes.push(dt);
              if (!awaitingDependencies.hasOwnProperty(dt)) {
                  awaitingDependencies[dt] = [];
              }
              awaitingDependencies[dt].push(function() {
                  typeConverters[i] = registeredTypes[dt];
                  ++registered;
                  if (registered === unregisteredTypes.length) {
                      onComplete(typeConverters);
                  }
              });
          }
      });
      if (0 === unregisteredTypes.length) {
          onComplete(typeConverters);
      }
    }function registerType(rawType, registeredInstance, options) {
      options = options || {};
  
      if (!('argPackAdvance' in registeredInstance)) {
          throw new TypeError('registerType registeredInstance requires argPackAdvance');
      }
  
      var name = registeredInstance.name;
      if (!rawType) {
          throwBindingError('type "' + name + '" must have a positive integer typeid pointer');
      }
      if (registeredTypes.hasOwnProperty(rawType)) {
          if (options.ignoreDuplicateRegistrations) {
              return;
          } else {
              throwBindingError("Cannot register type '" + name + "' twice");
          }
      }
  
      registeredTypes[rawType] = registeredInstance;
      delete typeDependencies[rawType];
  
      if (awaitingDependencies.hasOwnProperty(rawType)) {
          var callbacks = awaitingDependencies[rawType];
          delete awaitingDependencies[rawType];
          callbacks.forEach(function(cb) {
              cb();
          });
      }
    }function __embind_register_bool(rawType, name, size, trueValue, falseValue) {
      var shift = getShiftFromSize(size);
  
      name = readLatin1String(name);
      registerType(rawType, {
          name: name,
          'fromWireType': function(wt) {
              // ambiguous emscripten ABI: sometimes return values are
              // true or false, and sometimes integers (0 or 1)
              return !!wt;
          },
          'toWireType': function(destructors, o) {
              return o ? trueValue : falseValue;
          },
          'argPackAdvance': 8,
          'readValueFromPointer': function(pointer) {
              // TODO: if heap is fixed (like in asm.js) this could be executed outside
              var heap;
              if (size === 1) {
                  heap = HEAP8;
              } else if (size === 2) {
                  heap = HEAP16;
              } else if (size === 4) {
                  heap = HEAP32;
              } else {
                  throw new TypeError("Unknown boolean type size: " + name);
              }
              return this['fromWireType'](heap[pointer >> shift]);
          },
          destructorFunction: null, // This type does not need a destructor
      });
    }

  
  
  
  function ClassHandle_isAliasOf(other) {
      if (!(this instanceof ClassHandle)) {
          return false;
      }
      if (!(other instanceof ClassHandle)) {
          return false;
      }
  
      var leftClass = this.$$.ptrType.registeredClass;
      var left = this.$$.ptr;
      var rightClass = other.$$.ptrType.registeredClass;
      var right = other.$$.ptr;
  
      while (leftClass.baseClass) {
          left = leftClass.upcast(left);
          leftClass = leftClass.baseClass;
      }
  
      while (rightClass.baseClass) {
          right = rightClass.upcast(right);
          rightClass = rightClass.baseClass;
      }
  
      return leftClass === rightClass && left === right;
    }
  
  
  function shallowCopyInternalPointer(o) {
      return {
          count: o.count,
          deleteScheduled: o.deleteScheduled,
          preservePointerOnDelete: o.preservePointerOnDelete,
          ptr: o.ptr,
          ptrType: o.ptrType,
          smartPtr: o.smartPtr,
          smartPtrType: o.smartPtrType,
      };
    }
  
  function throwInstanceAlreadyDeleted(obj) {
      function getInstanceTypeName(handle) {
        return handle.$$.ptrType.registeredClass.name;
      }
      throwBindingError(getInstanceTypeName(obj) + ' instance already deleted');
    }
  
  
  var finalizationGroup=false;
  
  function detachFinalizer(handle) {}
  
  
  function runDestructor($$) {
      if ($$.smartPtr) {
          $$.smartPtrType.rawDestructor($$.smartPtr);
      } else {
          $$.ptrType.registeredClass.rawDestructor($$.ptr);
      }
    }function releaseClassHandle($$) {
      $$.count.value -= 1;
      var toDelete = 0 === $$.count.value;
      if (toDelete) {
          runDestructor($$);
      }
    }function attachFinalizer(handle) {
      if ('undefined' === typeof FinalizationGroup) {
          attachFinalizer = function (handle) { return handle; };
          return handle;
      }
      // If the running environment has a FinalizationGroup (see
      // https://github.com/tc39/proposal-weakrefs), then attach finalizers
      // for class handles.  We check for the presence of FinalizationGroup
      // at run-time, not build-time.
      finalizationGroup = new FinalizationGroup(function (iter) {
          for (var result = iter.next(); !result.done; result = iter.next()) {
              var $$ = result.value;
              if (!$$.ptr) {
                  console.warn('object already deleted: ' + $$.ptr);
              } else {
                  releaseClassHandle($$);
              }
          }
      });
      attachFinalizer = function(handle) {
          finalizationGroup.register(handle, handle.$$, handle.$$);
          return handle;
      };
      detachFinalizer = function(handle) {
          finalizationGroup.unregister(handle.$$);
      };
      return attachFinalizer(handle);
    }function ClassHandle_clone() {
      if (!this.$$.ptr) {
          throwInstanceAlreadyDeleted(this);
      }
  
      if (this.$$.preservePointerOnDelete) {
          this.$$.count.value += 1;
          return this;
      } else {
          var clone = attachFinalizer(Object.create(Object.getPrototypeOf(this), {
              $$: {
                  value: shallowCopyInternalPointer(this.$$),
              }
          }));
  
          clone.$$.count.value += 1;
          clone.$$.deleteScheduled = false;
          return clone;
      }
    }
  
  function ClassHandle_delete() {
      if (!this.$$.ptr) {
          throwInstanceAlreadyDeleted(this);
      }
  
      if (this.$$.deleteScheduled && !this.$$.preservePointerOnDelete) {
          throwBindingError('Object already scheduled for deletion');
      }
  
      detachFinalizer(this);
      releaseClassHandle(this.$$);
  
      if (!this.$$.preservePointerOnDelete) {
          this.$$.smartPtr = undefined;
          this.$$.ptr = undefined;
      }
    }
  
  function ClassHandle_isDeleted() {
      return !this.$$.ptr;
    }
  
  
  var delayFunction=undefined;
  
  var deletionQueue=[];
  
  function flushPendingDeletes() {
      while (deletionQueue.length) {
          var obj = deletionQueue.pop();
          obj.$$.deleteScheduled = false;
          obj['delete']();
      }
    }function ClassHandle_deleteLater() {
      if (!this.$$.ptr) {
          throwInstanceAlreadyDeleted(this);
      }
      if (this.$$.deleteScheduled && !this.$$.preservePointerOnDelete) {
          throwBindingError('Object already scheduled for deletion');
      }
      deletionQueue.push(this);
      if (deletionQueue.length === 1 && delayFunction) {
          delayFunction(flushPendingDeletes);
      }
      this.$$.deleteScheduled = true;
      return this;
    }function init_ClassHandle() {
      ClassHandle.prototype['isAliasOf'] = ClassHandle_isAliasOf;
      ClassHandle.prototype['clone'] = ClassHandle_clone;
      ClassHandle.prototype['delete'] = ClassHandle_delete;
      ClassHandle.prototype['isDeleted'] = ClassHandle_isDeleted;
      ClassHandle.prototype['deleteLater'] = ClassHandle_deleteLater;
    }function ClassHandle() {
    }
  
  var registeredPointers={};
  
  
  function ensureOverloadTable(proto, methodName, humanName) {
      if (undefined === proto[methodName].overloadTable) {
          var prevFunc = proto[methodName];
          // Inject an overload resolver function that routes to the appropriate overload based on the number of arguments.
          proto[methodName] = function() {
              // TODO This check can be removed in -O3 level "unsafe" optimizations.
              if (!proto[methodName].overloadTable.hasOwnProperty(arguments.length)) {
                  throwBindingError("Function '" + humanName + "' called with an invalid number of arguments (" + arguments.length + ") - expects one of (" + proto[methodName].overloadTable + ")!");
              }
              return proto[methodName].overloadTable[arguments.length].apply(this, arguments);
          };
          // Move the previous function into the overload table.
          proto[methodName].overloadTable = [];
          proto[methodName].overloadTable[prevFunc.argCount] = prevFunc;
      }
    }function exposePublicSymbol(name, value, numArguments) {
      if (Module.hasOwnProperty(name)) {
          if (undefined === numArguments || (undefined !== Module[name].overloadTable && undefined !== Module[name].overloadTable[numArguments])) {
              throwBindingError("Cannot register public name '" + name + "' twice");
          }
  
          // We are exposing a function with the same name as an existing function. Create an overload table and a function selector
          // that routes between the two.
          ensureOverloadTable(Module, name, name);
          if (Module.hasOwnProperty(numArguments)) {
              throwBindingError("Cannot register multiple overloads of a function with the same number of arguments (" + numArguments + ")!");
          }
          // Add the new function into the overload table.
          Module[name].overloadTable[numArguments] = value;
      }
      else {
          Module[name] = value;
          if (undefined !== numArguments) {
              Module[name].numArguments = numArguments;
          }
      }
    }
  
  function RegisteredClass(
      name,
      constructor,
      instancePrototype,
      rawDestructor,
      baseClass,
      getActualType,
      upcast,
      downcast
    ) {
      this.name = name;
      this.constructor = constructor;
      this.instancePrototype = instancePrototype;
      this.rawDestructor = rawDestructor;
      this.baseClass = baseClass;
      this.getActualType = getActualType;
      this.upcast = upcast;
      this.downcast = downcast;
      this.pureVirtualFunctions = [];
    }
  
  
  
  function upcastPointer(ptr, ptrClass, desiredClass) {
      while (ptrClass !== desiredClass) {
          if (!ptrClass.upcast) {
              throwBindingError("Expected null or instance of " + desiredClass.name + ", got an instance of " + ptrClass.name);
          }
          ptr = ptrClass.upcast(ptr);
          ptrClass = ptrClass.baseClass;
      }
      return ptr;
    }function constNoSmartPtrRawPointerToWireType(destructors, handle) {
      if (handle === null) {
          if (this.isReference) {
              throwBindingError('null is not a valid ' + this.name);
          }
          return 0;
      }
  
      if (!handle.$$) {
          throwBindingError('Cannot pass "' + _embind_repr(handle) + '" as a ' + this.name);
      }
      if (!handle.$$.ptr) {
          throwBindingError('Cannot pass deleted object as a pointer of type ' + this.name);
      }
      var handleClass = handle.$$.ptrType.registeredClass;
      var ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);
      return ptr;
    }
  
  function genericPointerToWireType(destructors, handle) {
      var ptr;
      if (handle === null) {
          if (this.isReference) {
              throwBindingError('null is not a valid ' + this.name);
          }
  
          if (this.isSmartPointer) {
              ptr = this.rawConstructor();
              if (destructors !== null) {
                  destructors.push(this.rawDestructor, ptr);
              }
              return ptr;
          } else {
              return 0;
          }
      }
  
      if (!handle.$$) {
          throwBindingError('Cannot pass "' + _embind_repr(handle) + '" as a ' + this.name);
      }
      if (!handle.$$.ptr) {
          throwBindingError('Cannot pass deleted object as a pointer of type ' + this.name);
      }
      if (!this.isConst && handle.$$.ptrType.isConst) {
          throwBindingError('Cannot convert argument of type ' + (handle.$$.smartPtrType ? handle.$$.smartPtrType.name : handle.$$.ptrType.name) + ' to parameter type ' + this.name);
      }
      var handleClass = handle.$$.ptrType.registeredClass;
      ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);
  
      if (this.isSmartPointer) {
          // TODO: this is not strictly true
          // We could support BY_EMVAL conversions from raw pointers to smart pointers
          // because the smart pointer can hold a reference to the handle
          if (undefined === handle.$$.smartPtr) {
              throwBindingError('Passing raw pointer to smart pointer is illegal');
          }
  
          switch (this.sharingPolicy) {
              case 0: // NONE
                  // no upcasting
                  if (handle.$$.smartPtrType === this) {
                      ptr = handle.$$.smartPtr;
                  } else {
                      throwBindingError('Cannot convert argument of type ' + (handle.$$.smartPtrType ? handle.$$.smartPtrType.name : handle.$$.ptrType.name) + ' to parameter type ' + this.name);
                  }
                  break;
  
              case 1: // INTRUSIVE
                  ptr = handle.$$.smartPtr;
                  break;
  
              case 2: // BY_EMVAL
                  if (handle.$$.smartPtrType === this) {
                      ptr = handle.$$.smartPtr;
                  } else {
                      var clonedHandle = handle['clone']();
                      ptr = this.rawShare(
                          ptr,
                          __emval_register(function() {
                              clonedHandle['delete']();
                          })
                      );
                      if (destructors !== null) {
                          destructors.push(this.rawDestructor, ptr);
                      }
                  }
                  break;
  
              default:
                  throwBindingError('Unsupporting sharing policy');
          }
      }
      return ptr;
    }
  
  function nonConstNoSmartPtrRawPointerToWireType(destructors, handle) {
      if (handle === null) {
          if (this.isReference) {
              throwBindingError('null is not a valid ' + this.name);
          }
          return 0;
      }
  
      if (!handle.$$) {
          throwBindingError('Cannot pass "' + _embind_repr(handle) + '" as a ' + this.name);
      }
      if (!handle.$$.ptr) {
          throwBindingError('Cannot pass deleted object as a pointer of type ' + this.name);
      }
      if (handle.$$.ptrType.isConst) {
          throwBindingError('Cannot convert argument of type ' + handle.$$.ptrType.name + ' to parameter type ' + this.name);
      }
      var handleClass = handle.$$.ptrType.registeredClass;
      var ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);
      return ptr;
    }
  
  
  function simpleReadValueFromPointer(pointer) {
      return this['fromWireType'](HEAPU32[pointer >> 2]);
    }
  
  function RegisteredPointer_getPointee(ptr) {
      if (this.rawGetPointee) {
          ptr = this.rawGetPointee(ptr);
      }
      return ptr;
    }
  
  function RegisteredPointer_destructor(ptr) {
      if (this.rawDestructor) {
          this.rawDestructor(ptr);
      }
    }
  
  function RegisteredPointer_deleteObject(handle) {
      if (handle !== null) {
          handle['delete']();
      }
    }
  
  
  function downcastPointer(ptr, ptrClass, desiredClass) {
      if (ptrClass === desiredClass) {
          return ptr;
      }
      if (undefined === desiredClass.baseClass) {
          return null; // no conversion
      }
  
      var rv = downcastPointer(ptr, ptrClass, desiredClass.baseClass);
      if (rv === null) {
          return null;
      }
      return desiredClass.downcast(rv);
    }
  
  
  
  
  function getInheritedInstanceCount() {
      return Object.keys(registeredInstances).length;
    }
  
  function getLiveInheritedInstances() {
      var rv = [];
      for (var k in registeredInstances) {
          if (registeredInstances.hasOwnProperty(k)) {
              rv.push(registeredInstances[k]);
          }
      }
      return rv;
    }
  
  function setDelayFunction(fn) {
      delayFunction = fn;
      if (deletionQueue.length && delayFunction) {
          delayFunction(flushPendingDeletes);
      }
    }function init_embind() {
      Module['getInheritedInstanceCount'] = getInheritedInstanceCount;
      Module['getLiveInheritedInstances'] = getLiveInheritedInstances;
      Module['flushPendingDeletes'] = flushPendingDeletes;
      Module['setDelayFunction'] = setDelayFunction;
    }var registeredInstances={};
  
  function getBasestPointer(class_, ptr) {
      if (ptr === undefined) {
          throwBindingError('ptr should not be undefined');
      }
      while (class_.baseClass) {
          ptr = class_.upcast(ptr);
          class_ = class_.baseClass;
      }
      return ptr;
    }function getInheritedInstance(class_, ptr) {
      ptr = getBasestPointer(class_, ptr);
      return registeredInstances[ptr];
    }
  
  function makeClassHandle(prototype, record) {
      if (!record.ptrType || !record.ptr) {
          throwInternalError('makeClassHandle requires ptr and ptrType');
      }
      var hasSmartPtrType = !!record.smartPtrType;
      var hasSmartPtr = !!record.smartPtr;
      if (hasSmartPtrType !== hasSmartPtr) {
          throwInternalError('Both smartPtrType and smartPtr must be specified');
      }
      record.count = { value: 1 };
      return attachFinalizer(Object.create(prototype, {
          $$: {
              value: record,
          },
      }));
    }function RegisteredPointer_fromWireType(ptr) {
      // ptr is a raw pointer (or a raw smartpointer)
  
      // rawPointer is a maybe-null raw pointer
      var rawPointer = this.getPointee(ptr);
      if (!rawPointer) {
          this.destructor(ptr);
          return null;
      }
  
      var registeredInstance = getInheritedInstance(this.registeredClass, rawPointer);
      if (undefined !== registeredInstance) {
          // JS object has been neutered, time to repopulate it
          if (0 === registeredInstance.$$.count.value) {
              registeredInstance.$$.ptr = rawPointer;
              registeredInstance.$$.smartPtr = ptr;
              return registeredInstance['clone']();
          } else {
              // else, just increment reference count on existing object
              // it already has a reference to the smart pointer
              var rv = registeredInstance['clone']();
              this.destructor(ptr);
              return rv;
          }
      }
  
      function makeDefaultHandle() {
          if (this.isSmartPointer) {
              return makeClassHandle(this.registeredClass.instancePrototype, {
                  ptrType: this.pointeeType,
                  ptr: rawPointer,
                  smartPtrType: this,
                  smartPtr: ptr,
              });
          } else {
              return makeClassHandle(this.registeredClass.instancePrototype, {
                  ptrType: this,
                  ptr: ptr,
              });
          }
      }
  
      var actualType = this.registeredClass.getActualType(rawPointer);
      var registeredPointerRecord = registeredPointers[actualType];
      if (!registeredPointerRecord) {
          return makeDefaultHandle.call(this);
      }
  
      var toType;
      if (this.isConst) {
          toType = registeredPointerRecord.constPointerType;
      } else {
          toType = registeredPointerRecord.pointerType;
      }
      var dp = downcastPointer(
          rawPointer,
          this.registeredClass,
          toType.registeredClass);
      if (dp === null) {
          return makeDefaultHandle.call(this);
      }
      if (this.isSmartPointer) {
          return makeClassHandle(toType.registeredClass.instancePrototype, {
              ptrType: toType,
              ptr: dp,
              smartPtrType: this,
              smartPtr: ptr,
          });
      } else {
          return makeClassHandle(toType.registeredClass.instancePrototype, {
              ptrType: toType,
              ptr: dp,
          });
      }
    }function init_RegisteredPointer() {
      RegisteredPointer.prototype.getPointee = RegisteredPointer_getPointee;
      RegisteredPointer.prototype.destructor = RegisteredPointer_destructor;
      RegisteredPointer.prototype['argPackAdvance'] = 8;
      RegisteredPointer.prototype['readValueFromPointer'] = simpleReadValueFromPointer;
      RegisteredPointer.prototype['deleteObject'] = RegisteredPointer_deleteObject;
      RegisteredPointer.prototype['fromWireType'] = RegisteredPointer_fromWireType;
    }function RegisteredPointer(
      name,
      registeredClass,
      isReference,
      isConst,
  
      // smart pointer properties
      isSmartPointer,
      pointeeType,
      sharingPolicy,
      rawGetPointee,
      rawConstructor,
      rawShare,
      rawDestructor
    ) {
      this.name = name;
      this.registeredClass = registeredClass;
      this.isReference = isReference;
      this.isConst = isConst;
  
      // smart pointer properties
      this.isSmartPointer = isSmartPointer;
      this.pointeeType = pointeeType;
      this.sharingPolicy = sharingPolicy;
      this.rawGetPointee = rawGetPointee;
      this.rawConstructor = rawConstructor;
      this.rawShare = rawShare;
      this.rawDestructor = rawDestructor;
  
      if (!isSmartPointer && registeredClass.baseClass === undefined) {
          if (isConst) {
              this['toWireType'] = constNoSmartPtrRawPointerToWireType;
              this.destructorFunction = null;
          } else {
              this['toWireType'] = nonConstNoSmartPtrRawPointerToWireType;
              this.destructorFunction = null;
          }
      } else {
          this['toWireType'] = genericPointerToWireType;
          // Here we must leave this.destructorFunction undefined, since whether genericPointerToWireType returns
          // a pointer that needs to be freed up is runtime-dependent, and cannot be evaluated at registration time.
          // TODO: Create an alternative mechanism that allows removing the use of var destructors = []; array in
          //       craftInvokerFunction altogether.
      }
    }
  
  function replacePublicSymbol(name, value, numArguments) {
      if (!Module.hasOwnProperty(name)) {
          throwInternalError('Replacing nonexistant public symbol');
      }
      // If there's an overload table for this symbol, replace the symbol in the overload table instead.
      if (undefined !== Module[name].overloadTable && undefined !== numArguments) {
          Module[name].overloadTable[numArguments] = value;
      }
      else {
          Module[name] = value;
          Module[name].argCount = numArguments;
      }
    }
  
  function embind__requireFunction(signature, rawFunction) {
      signature = readLatin1String(signature);
  
      function makeDynCaller(dynCall) {
          var args = [];
          for (var i = 1; i < signature.length; ++i) {
              args.push('a' + i);
          }
  
          var name = 'dynCall_' + signature + '_' + rawFunction;
          var body = 'return function ' + name + '(' + args.join(', ') + ') {\n';
          body    += '    return dynCall(rawFunction' + (args.length ? ', ' : '') + args.join(', ') + ');\n';
          body    += '};\n';
  
          return (new Function('dynCall', 'rawFunction', body))(dynCall, rawFunction);
      }
  
      var fp;
      if (Module['FUNCTION_TABLE_' + signature] !== undefined) {
          fp = Module['FUNCTION_TABLE_' + signature][rawFunction];
      } else if (typeof FUNCTION_TABLE !== "undefined") {
          fp = FUNCTION_TABLE[rawFunction];
      } else {
          // asm.js does not give direct access to the function tables,
          // and thus we must go through the dynCall interface which allows
          // calling into a signature's function table by pointer value.
          //
          // https://github.com/dherman/asm.js/issues/83
          //
          // This has three main penalties:
          // - dynCall is another function call in the path from JavaScript to C++.
          // - JITs may not predict through the function table indirection at runtime.
          var dc = Module['dynCall_' + signature];
          if (dc === undefined) {
              // We will always enter this branch if the signature
              // contains 'f' and PRECISE_F32 is not enabled.
              //
              // Try again, replacing 'f' with 'd'.
              dc = Module['dynCall_' + signature.replace(/f/g, 'd')];
              if (dc === undefined) {
                  throwBindingError("No dynCall invoker for signature: " + signature);
              }
          }
          fp = makeDynCaller(dc);
      }
  
      if (typeof fp !== "function") {
          throwBindingError("unknown function pointer with signature " + signature + ": " + rawFunction);
      }
      return fp;
    }
  
  
  var UnboundTypeError=undefined;
  
  function getTypeName(type) {
      var ptr = ___getTypeName(type);
      var rv = readLatin1String(ptr);
      _free(ptr);
      return rv;
    }function throwUnboundTypeError(message, types) {
      var unboundTypes = [];
      var seen = {};
      function visit(type) {
          if (seen[type]) {
              return;
          }
          if (registeredTypes[type]) {
              return;
          }
          if (typeDependencies[type]) {
              typeDependencies[type].forEach(visit);
              return;
          }
          unboundTypes.push(type);
          seen[type] = true;
      }
      types.forEach(visit);
  
      throw new UnboundTypeError(message + ': ' + unboundTypes.map(getTypeName).join([', ']));
    }function __embind_register_class(
      rawType,
      rawPointerType,
      rawConstPointerType,
      baseClassRawType,
      getActualTypeSignature,
      getActualType,
      upcastSignature,
      upcast,
      downcastSignature,
      downcast,
      name,
      destructorSignature,
      rawDestructor
    ) {
      name = readLatin1String(name);
      getActualType = embind__requireFunction(getActualTypeSignature, getActualType);
      if (upcast) {
          upcast = embind__requireFunction(upcastSignature, upcast);
      }
      if (downcast) {
          downcast = embind__requireFunction(downcastSignature, downcast);
      }
      rawDestructor = embind__requireFunction(destructorSignature, rawDestructor);
      var legalFunctionName = makeLegalFunctionName(name);
  
      exposePublicSymbol(legalFunctionName, function() {
          // this code cannot run if baseClassRawType is zero
          throwUnboundTypeError('Cannot construct ' + name + ' due to unbound types', [baseClassRawType]);
      });
  
      whenDependentTypesAreResolved(
          [rawType, rawPointerType, rawConstPointerType],
          baseClassRawType ? [baseClassRawType] : [],
          function(base) {
              base = base[0];
  
              var baseClass;
              var basePrototype;
              if (baseClassRawType) {
                  baseClass = base.registeredClass;
                  basePrototype = baseClass.instancePrototype;
              } else {
                  basePrototype = ClassHandle.prototype;
              }
  
              var constructor = createNamedFunction(legalFunctionName, function() {
                  if (Object.getPrototypeOf(this) !== instancePrototype) {
                      throw new BindingError("Use 'new' to construct " + name);
                  }
                  if (undefined === registeredClass.constructor_body) {
                      throw new BindingError(name + " has no accessible constructor");
                  }
                  var body = registeredClass.constructor_body[arguments.length];
                  if (undefined === body) {
                      throw new BindingError("Tried to invoke ctor of " + name + " with invalid number of parameters (" + arguments.length + ") - expected (" + Object.keys(registeredClass.constructor_body).toString() + ") parameters instead!");
                  }
                  return body.apply(this, arguments);
              });
  
              var instancePrototype = Object.create(basePrototype, {
                  constructor: { value: constructor },
              });
  
              constructor.prototype = instancePrototype;
  
              var registeredClass = new RegisteredClass(
                  name,
                  constructor,
                  instancePrototype,
                  rawDestructor,
                  baseClass,
                  getActualType,
                  upcast,
                  downcast);
  
              var referenceConverter = new RegisteredPointer(
                  name,
                  registeredClass,
                  true,
                  false,
                  false);
  
              var pointerConverter = new RegisteredPointer(
                  name + '*',
                  registeredClass,
                  false,
                  false,
                  false);
  
              var constPointerConverter = new RegisteredPointer(
                  name + ' const*',
                  registeredClass,
                  false,
                  true,
                  false);
  
              registeredPointers[rawType] = {
                  pointerType: pointerConverter,
                  constPointerType: constPointerConverter
              };
  
              replacePublicSymbol(legalFunctionName, constructor);
  
              return [referenceConverter, pointerConverter, constPointerConverter];
          }
      );
    }

  
  
  function new_(constructor, argumentList) {
      if (!(constructor instanceof Function)) {
          throw new TypeError('new_ called with constructor type ' + typeof(constructor) + " which is not a function");
      }
  
      /*
       * Previously, the following line was just:
  
       function dummy() {};
  
       * Unfortunately, Chrome was preserving 'dummy' as the object's name, even though at creation, the 'dummy' has the
       * correct constructor name.  Thus, objects created with IMVU.new would show up in the debugger as 'dummy', which
       * isn't very helpful.  Using IMVU.createNamedFunction addresses the issue.  Doublely-unfortunately, there's no way
       * to write a test for this behavior.  -NRD 2013.02.22
       */
      var dummy = createNamedFunction(constructor.name || 'unknownFunctionName', function(){});
      dummy.prototype = constructor.prototype;
      var obj = new dummy;
  
      var r = constructor.apply(obj, argumentList);
      return (r instanceof Object) ? r : obj;
    }
  
  function runDestructors(destructors) {
      while (destructors.length) {
          var ptr = destructors.pop();
          var del = destructors.pop();
          del(ptr);
      }
    }function craftInvokerFunction(humanName, argTypes, classType, cppInvokerFunc, cppTargetFunc) {
      // humanName: a human-readable string name for the function to be generated.
      // argTypes: An array that contains the embind type objects for all types in the function signature.
      //    argTypes[0] is the type object for the function return value.
      //    argTypes[1] is the type object for function this object/class type, or null if not crafting an invoker for a class method.
      //    argTypes[2...] are the actual function parameters.
      // classType: The embind type object for the class to be bound, or null if this is not a method of a class.
      // cppInvokerFunc: JS Function object to the C++-side function that interops into C++ code.
      // cppTargetFunc: Function pointer (an integer to FUNCTION_TABLE) to the target C++ function the cppInvokerFunc will end up calling.
      var argCount = argTypes.length;
  
      if (argCount < 2) {
          throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!");
      }
  
      var isClassMethodFunc = (argTypes[1] !== null && classType !== null);
  
      // Free functions with signature "void function()" do not need an invoker that marshalls between wire types.
  // TODO: This omits argument count check - enable only at -O3 or similar.
  //    if (ENABLE_UNSAFE_OPTS && argCount == 2 && argTypes[0].name == "void" && !isClassMethodFunc) {
  //       return FUNCTION_TABLE[fn];
  //    }
  
  
      // Determine if we need to use a dynamic stack to store the destructors for the function parameters.
      // TODO: Remove this completely once all function invokers are being dynamically generated.
      var needsDestructorStack = false;
  
      for(var i = 1; i < argTypes.length; ++i) { // Skip return value at index 0 - it's not deleted here.
          if (argTypes[i] !== null && argTypes[i].destructorFunction === undefined) { // The type does not define a destructor function - must use dynamic stack
              needsDestructorStack = true;
              break;
          }
      }
  
      var returns = (argTypes[0].name !== "void");
  
      var argsList = "";
      var argsListWired = "";
      for(var i = 0; i < argCount - 2; ++i) {
          argsList += (i!==0?", ":"")+"arg"+i;
          argsListWired += (i!==0?", ":"")+"arg"+i+"Wired";
      }
  
      var invokerFnBody =
          "return function "+makeLegalFunctionName(humanName)+"("+argsList+") {\n" +
          "if (arguments.length !== "+(argCount - 2)+") {\n" +
              "throwBindingError('function "+humanName+" called with ' + arguments.length + ' arguments, expected "+(argCount - 2)+" args!');\n" +
          "}\n";
  
  
      if (needsDestructorStack) {
          invokerFnBody +=
              "var destructors = [];\n";
      }
  
      var dtorStack = needsDestructorStack ? "destructors" : "null";
      var args1 = ["throwBindingError", "invoker", "fn", "runDestructors", "retType", "classParam"];
      var args2 = [throwBindingError, cppInvokerFunc, cppTargetFunc, runDestructors, argTypes[0], argTypes[1]];
  
  
      if (isClassMethodFunc) {
          invokerFnBody += "var thisWired = classParam.toWireType("+dtorStack+", this);\n";
      }
  
      for(var i = 0; i < argCount - 2; ++i) {
          invokerFnBody += "var arg"+i+"Wired = argType"+i+".toWireType("+dtorStack+", arg"+i+"); // "+argTypes[i+2].name+"\n";
          args1.push("argType"+i);
          args2.push(argTypes[i+2]);
      }
  
      if (isClassMethodFunc) {
          argsListWired = "thisWired" + (argsListWired.length > 0 ? ", " : "") + argsListWired;
      }
  
      invokerFnBody +=
          (returns?"var rv = ":"") + "invoker(fn"+(argsListWired.length>0?", ":"")+argsListWired+");\n";
  
      if (needsDestructorStack) {
          invokerFnBody += "runDestructors(destructors);\n";
      } else {
          for(var i = isClassMethodFunc?1:2; i < argTypes.length; ++i) { // Skip return value at index 0 - it's not deleted here. Also skip class type if not a method.
              var paramName = (i === 1 ? "thisWired" : ("arg"+(i - 2)+"Wired"));
              if (argTypes[i].destructorFunction !== null) {
                  invokerFnBody += paramName+"_dtor("+paramName+"); // "+argTypes[i].name+"\n";
                  args1.push(paramName+"_dtor");
                  args2.push(argTypes[i].destructorFunction);
              }
          }
      }
  
      if (returns) {
          invokerFnBody += "var ret = retType.fromWireType(rv);\n" +
                           "return ret;\n";
      } else {
      }
      invokerFnBody += "}\n";
  
      args1.push(invokerFnBody);
  
      var invokerFunction = new_(Function, args1).apply(null, args2);
      return invokerFunction;
    }
  
  function heap32VectorToArray(count, firstElement) {
      var array = [];
      for (var i = 0; i < count; i++) {
          array.push(HEAP32[(firstElement >> 2) + i]);
      }
      return array;
    }function __embind_register_class_function(
      rawClassType,
      methodName,
      argCount,
      rawArgTypesAddr, // [ReturnType, ThisType, Args...]
      invokerSignature,
      rawInvoker,
      context,
      isPureVirtual
    ) {
      var rawArgTypes = heap32VectorToArray(argCount, rawArgTypesAddr);
      methodName = readLatin1String(methodName);
      rawInvoker = embind__requireFunction(invokerSignature, rawInvoker);
  
      whenDependentTypesAreResolved([], [rawClassType], function(classType) {
          classType = classType[0];
          var humanName = classType.name + '.' + methodName;
  
          if (isPureVirtual) {
              classType.registeredClass.pureVirtualFunctions.push(methodName);
          }
  
          function unboundTypesHandler() {
              throwUnboundTypeError('Cannot call ' + humanName + ' due to unbound types', rawArgTypes);
          }
  
          var proto = classType.registeredClass.instancePrototype;
          var method = proto[methodName];
          if (undefined === method || (undefined === method.overloadTable && method.className !== classType.name && method.argCount === argCount - 2)) {
              // This is the first overload to be registered, OR we are replacing a function in the base class with a function in the derived class.
              unboundTypesHandler.argCount = argCount - 2;
              unboundTypesHandler.className = classType.name;
              proto[methodName] = unboundTypesHandler;
          } else {
              // There was an existing function with the same name registered. Set up a function overload routing table.
              ensureOverloadTable(proto, methodName, humanName);
              proto[methodName].overloadTable[argCount - 2] = unboundTypesHandler;
          }
  
          whenDependentTypesAreResolved([], rawArgTypes, function(argTypes) {
  
              var memberFunction = craftInvokerFunction(humanName, argTypes, classType, rawInvoker, context);
  
              // Replace the initial unbound-handler-stub function with the appropriate member function, now that all types
              // are resolved. If multiple overloads are registered for this function, the function goes into an overload table.
              if (undefined === proto[methodName].overloadTable) {
                  // Set argCount in case an overload is registered later
                  memberFunction.argCount = argCount - 2;
                  proto[methodName] = memberFunction;
              } else {
                  proto[methodName].overloadTable[argCount - 2] = memberFunction;
              }
  
              return [];
          });
          return [];
      });
    }

  
  
  var emval_free_list=[];
  
  var emval_handle_array=[{},{value:undefined},{value:null},{value:true},{value:false}];function __emval_decref(handle) {
      if (handle > 4 && 0 === --emval_handle_array[handle].refcount) {
          emval_handle_array[handle] = undefined;
          emval_free_list.push(handle);
      }
    }
  
  
  
  function count_emval_handles() {
      var count = 0;
      for (var i = 5; i < emval_handle_array.length; ++i) {
          if (emval_handle_array[i] !== undefined) {
              ++count;
          }
      }
      return count;
    }
  
  function get_first_emval() {
      for (var i = 5; i < emval_handle_array.length; ++i) {
          if (emval_handle_array[i] !== undefined) {
              return emval_handle_array[i];
          }
      }
      return null;
    }function init_emval() {
      Module['count_emval_handles'] = count_emval_handles;
      Module['get_first_emval'] = get_first_emval;
    }function __emval_register(value) {
  
      switch(value){
        case undefined :{ return 1; }
        case null :{ return 2; }
        case true :{ return 3; }
        case false :{ return 4; }
        default:{
          var handle = emval_free_list.length ?
              emval_free_list.pop() :
              emval_handle_array.length;
  
          emval_handle_array[handle] = {refcount: 1, value: value};
          return handle;
          }
        }
    }function __embind_register_emval(rawType, name) {
      name = readLatin1String(name);
      registerType(rawType, {
          name: name,
          'fromWireType': function(handle) {
              var rv = emval_handle_array[handle].value;
              __emval_decref(handle);
              return rv;
          },
          'toWireType': function(destructors, value) {
              return __emval_register(value);
          },
          'argPackAdvance': 8,
          'readValueFromPointer': simpleReadValueFromPointer,
          destructorFunction: null, // This type does not need a destructor
  
          // TODO: do we need a deleteObject here?  write a test where
          // emval is passed into JS via an interface
      });
    }

  
  function _embind_repr(v) {
      if (v === null) {
          return 'null';
      }
      var t = typeof v;
      if (t === 'object' || t === 'array' || t === 'function') {
          return v.toString();
      } else {
          return '' + v;
      }
    }
  
  function floatReadValueFromPointer(name, shift) {
      switch (shift) {
          case 2: return function(pointer) {
              return this['fromWireType'](HEAPF32[pointer >> 2]);
          };
          case 3: return function(pointer) {
              return this['fromWireType'](HEAPF64[pointer >> 3]);
          };
          default:
              throw new TypeError("Unknown float type: " + name);
      }
    }function __embind_register_float(rawType, name, size) {
      var shift = getShiftFromSize(size);
      name = readLatin1String(name);
      registerType(rawType, {
          name: name,
          'fromWireType': function(value) {
              return value;
          },
          'toWireType': function(destructors, value) {
              // todo: Here we have an opportunity for -O3 level "unsafe" optimizations: we could
              // avoid the following if() and assume value is of proper type.
              if (typeof value !== "number" && typeof value !== "boolean") {
                  throw new TypeError('Cannot convert "' + _embind_repr(value) + '" to ' + this.name);
              }
              return value;
          },
          'argPackAdvance': 8,
          'readValueFromPointer': floatReadValueFromPointer(name, shift),
          destructorFunction: null, // This type does not need a destructor
      });
    }

  function __embind_register_function(name, argCount, rawArgTypesAddr, signature, rawInvoker, fn) {
      var argTypes = heap32VectorToArray(argCount, rawArgTypesAddr);
      name = readLatin1String(name);
  
      rawInvoker = embind__requireFunction(signature, rawInvoker);
  
      exposePublicSymbol(name, function() {
          throwUnboundTypeError('Cannot call ' + name + ' due to unbound types', argTypes);
      }, argCount - 1);
  
      whenDependentTypesAreResolved([], argTypes, function(argTypes) {
          var invokerArgsArray = [argTypes[0] /* return value */, null /* no class 'this'*/].concat(argTypes.slice(1) /* actual params */);
          replacePublicSymbol(name, craftInvokerFunction(name, invokerArgsArray, null /* no class 'this'*/, rawInvoker, fn), argCount - 1);
          return [];
      });
    }

  
  function integerReadValueFromPointer(name, shift, signed) {
      // integers are quite common, so generate very specialized functions
      switch (shift) {
          case 0: return signed ?
              function readS8FromPointer(pointer) { return HEAP8[pointer]; } :
              function readU8FromPointer(pointer) { return HEAPU8[pointer]; };
          case 1: return signed ?
              function readS16FromPointer(pointer) { return HEAP16[pointer >> 1]; } :
              function readU16FromPointer(pointer) { return HEAPU16[pointer >> 1]; };
          case 2: return signed ?
              function readS32FromPointer(pointer) { return HEAP32[pointer >> 2]; } :
              function readU32FromPointer(pointer) { return HEAPU32[pointer >> 2]; };
          default:
              throw new TypeError("Unknown integer type: " + name);
      }
    }function __embind_register_integer(primitiveType, name, size, minRange, maxRange) {
      name = readLatin1String(name);
      if (maxRange === -1) { // LLVM doesn't have signed and unsigned 32-bit types, so u32 literals come out as 'i32 -1'. Always treat those as max u32.
          maxRange = 4294967295;
      }
  
      var shift = getShiftFromSize(size);
  
      var fromWireType = function(value) {
          return value;
      };
  
      if (minRange === 0) {
          var bitshift = 32 - 8*size;
          fromWireType = function(value) {
              return (value << bitshift) >>> bitshift;
          };
      }
  
      var isUnsignedType = (name.indexOf('unsigned') != -1);
  
      registerType(primitiveType, {
          name: name,
          'fromWireType': fromWireType,
          'toWireType': function(destructors, value) {
              // todo: Here we have an opportunity for -O3 level "unsafe" optimizations: we could
              // avoid the following two if()s and assume value is of proper type.
              if (typeof value !== "number" && typeof value !== "boolean") {
                  throw new TypeError('Cannot convert "' + _embind_repr(value) + '" to ' + this.name);
              }
              if (value < minRange || value > maxRange) {
                  throw new TypeError('Passing a number "' + _embind_repr(value) + '" from JS side to C/C++ side to an argument of type "' + name + '", which is outside the valid range [' + minRange + ', ' + maxRange + ']!');
              }
              return isUnsignedType ? (value >>> 0) : (value | 0);
          },
          'argPackAdvance': 8,
          'readValueFromPointer': integerReadValueFromPointer(name, shift, minRange !== 0),
          destructorFunction: null, // This type does not need a destructor
      });
    }

  function __embind_register_memory_view(rawType, dataTypeIndex, name) {
      var typeMapping = [
          Int8Array,
          Uint8Array,
          Int16Array,
          Uint16Array,
          Int32Array,
          Uint32Array,
          Float32Array,
          Float64Array,
      ];
  
      var TA = typeMapping[dataTypeIndex];
  
      function decodeMemoryView(handle) {
          handle = handle >> 2;
          var heap = HEAPU32;
          var size = heap[handle]; // in elements
          var data = heap[handle + 1]; // byte offset into emscripten heap
          return new TA(heap['buffer'], data, size);
      }
  
      name = readLatin1String(name);
      registerType(rawType, {
          name: name,
          'fromWireType': decodeMemoryView,
          'argPackAdvance': 8,
          'readValueFromPointer': decodeMemoryView,
      }, {
          ignoreDuplicateRegistrations: true,
      });
    }

  function __embind_register_std_string(rawType, name) {
      name = readLatin1String(name);
      var stdStringIsUTF8
      //process only std::string bindings with UTF8 support, in contrast to e.g. std::basic_string<unsigned char>
      = (name === "std::string");
  
      registerType(rawType, {
          name: name,
          'fromWireType': function(value) {
              var length = HEAPU32[value >> 2];
  
              var str;
              if(stdStringIsUTF8) {
                  //ensure null termination at one-past-end byte if not present yet
                  var endChar = HEAPU8[value + 4 + length];
                  var endCharSwap = 0;
                  if(endChar != 0)
                  {
                    endCharSwap = endChar;
                    HEAPU8[value + 4 + length] = 0;
                  }
  
                  var decodeStartPtr = value + 4;
                  //looping here to support possible embedded '0' bytes
                  for (var i = 0; i <= length; ++i) {
                    var currentBytePtr = value + 4 + i;
                    if(HEAPU8[currentBytePtr] == 0)
                    {
                      var stringSegment = UTF8ToString(decodeStartPtr);
                      if(str === undefined)
                        str = stringSegment;
                      else
                      {
                        str += String.fromCharCode(0);
                        str += stringSegment;
                      }
                      decodeStartPtr = currentBytePtr + 1;
                    }
                  }
  
                  if(endCharSwap != 0)
                    HEAPU8[value + 4 + length] = endCharSwap;
              } else {
                  var a = new Array(length);
                  for (var i = 0; i < length; ++i) {
                      a[i] = String.fromCharCode(HEAPU8[value + 4 + i]);
                  }
                  str = a.join('');
              }
  
              _free(value);
              
              return str;
          },
          'toWireType': function(destructors, value) {
              if (value instanceof ArrayBuffer) {
                  value = new Uint8Array(value);
              }
              
              var getLength;
              var valueIsOfTypeString = (typeof value === 'string');
  
              if (!(valueIsOfTypeString || value instanceof Uint8Array || value instanceof Uint8ClampedArray || value instanceof Int8Array)) {
                  throwBindingError('Cannot pass non-string to std::string');
              }
              if (stdStringIsUTF8 && valueIsOfTypeString) {
                  getLength = function() {return lengthBytesUTF8(value);};
              } else {
                  getLength = function() {return value.length;};
              }
              
              // assumes 4-byte alignment
              var length = getLength();
              var ptr = _malloc(4 + length + 1);
              HEAPU32[ptr >> 2] = length;
  
              if (stdStringIsUTF8 && valueIsOfTypeString) {
                  stringToUTF8(value, ptr + 4, length + 1);
              } else {
                  if(valueIsOfTypeString) {
                      for (var i = 0; i < length; ++i) {
                          var charCode = value.charCodeAt(i);
                          if (charCode > 255) {
                              _free(ptr);
                              throwBindingError('String has UTF-16 code units that do not fit in 8 bits');
                          }
                          HEAPU8[ptr + 4 + i] = charCode;
                      }
                  } else {
                      for (var i = 0; i < length; ++i) {
                          HEAPU8[ptr + 4 + i] = value[i];
                      }
                  }
              }
  
              if (destructors !== null) {
                  destructors.push(_free, ptr);
              }
              return ptr;
          },
          'argPackAdvance': 8,
          'readValueFromPointer': simpleReadValueFromPointer,
          destructorFunction: function(ptr) { _free(ptr); },
      });
    }

  function __embind_register_std_wstring(rawType, charSize, name) {
      // nb. do not cache HEAPU16 and HEAPU32, they may be destroyed by emscripten_resize_heap().
      name = readLatin1String(name);
      var getHeap, shift;
      if (charSize === 2) {
          getHeap = function() { return HEAPU16; };
          shift = 1;
      } else if (charSize === 4) {
          getHeap = function() { return HEAPU32; };
          shift = 2;
      }
      registerType(rawType, {
          name: name,
          'fromWireType': function(value) {
              var HEAP = getHeap();
              var length = HEAPU32[value >> 2];
              var a = new Array(length);
              var start = (value + 4) >> shift;
              for (var i = 0; i < length; ++i) {
                  a[i] = String.fromCharCode(HEAP[start + i]);
              }
              _free(value);
              return a.join('');
          },
          'toWireType': function(destructors, value) {
              // assumes 4-byte alignment
              var HEAP = getHeap();
              var length = value.length;
              var ptr = _malloc(4 + length * charSize);
              HEAPU32[ptr >> 2] = length;
              var start = (ptr + 4) >> shift;
              for (var i = 0; i < length; ++i) {
                  HEAP[start + i] = value.charCodeAt(i);
              }
              if (destructors !== null) {
                  destructors.push(_free, ptr);
              }
              return ptr;
          },
          'argPackAdvance': 8,
          'readValueFromPointer': simpleReadValueFromPointer,
          destructorFunction: function(ptr) { _free(ptr); },
      });
    }

  function __embind_register_void(rawType, name) {
      name = readLatin1String(name);
      registerType(rawType, {
          isVoid: true, // void return values can be optimized out sometimes
          name: name,
          'argPackAdvance': 0,
          'fromWireType': function() {
              return undefined;
          },
          'toWireType': function(destructors, o) {
              // TODO: assert if anything else is given?
              return undefined;
          },
      });
    }

  
  function requireHandle(handle) {
      if (!handle) {
          throwBindingError('Cannot use deleted val. handle = ' + handle);
      }
      return emval_handle_array[handle].value;
    }
  
  function requireRegisteredType(rawType, humanName) {
      var impl = registeredTypes[rawType];
      if (undefined === impl) {
          throwBindingError(humanName + " has unknown type " + getTypeName(rawType));
      }
      return impl;
    }function __emval_as(handle, returnType, destructorsRef) {
      handle = requireHandle(handle);
      returnType = requireRegisteredType(returnType, 'emval::as');
      var destructors = [];
      var rd = __emval_register(destructors);
      HEAP32[destructorsRef >> 2] = rd;
      return returnType['toWireType'](destructors, handle);
    }


  function __emval_get_property(handle, key) {
      handle = requireHandle(handle);
      key = requireHandle(key);
      return __emval_register(handle[key]);
    }

  function __emval_incref(handle) {
      if (handle > 4) {
          emval_handle_array[handle].refcount += 1;
      }
    }

  
  
  var emval_symbols={};function getStringOrSymbol(address) {
      var symbol = emval_symbols[address];
      if (symbol === undefined) {
          return readLatin1String(address);
      } else {
          return symbol;
      }
    }function __emval_new_cstring(v) {
      return __emval_register(getStringOrSymbol(v));
    }

  function __emval_run_destructors(handle) {
      var destructors = emval_handle_array[handle].value;
      runDestructors(destructors);
      __emval_decref(handle);
    }

  function __emval_take_value(type, argv) {
      type = requireRegisteredType(type, '_emval_take_value');
      var v = type['readValueFromPointer'](argv);
      return __emval_register(v);
    }

  function _abort() {
      Module['abort']();
    }

  function _emscripten_get_heap_size() {
      return HEAP8.length;
    }

  
  function _emscripten_memcpy_big(dest, src, num) {
      HEAPU8.set(HEAPU8.subarray(src, src+num), dest);
    }
  
   

   

  
  function ___setErrNo(value) {
      if (Module['___errno_location']) HEAP32[((Module['___errno_location']())>>2)]=value;
      return value;
    }
  
  
  function abortOnCannotGrowMemory(requestedSize) {
      abort('OOM');
    }
  
  function emscripten_realloc_buffer(size) {
      try {
        // round size grow request up to wasm page size (fixed 64KB per spec)
        wasmMemory.grow((size - buffer.byteLength + 65535) >> 16); // .grow() takes a delta compared to the previous size
        updateGlobalBufferAndViews(wasmMemory.buffer);
        return 1 /*success*/;
      } catch(e) {
      }
    }function _emscripten_resize_heap(requestedSize) {
      var oldSize = _emscripten_get_heap_size();
      // With pthreads, races can happen (another thread might increase the size in between), so return a failure, and let the caller retry.
  
  
      var PAGE_MULTIPLE = 65536;
      var LIMIT = 2147483648 - PAGE_MULTIPLE; // We can do one page short of 2GB as theoretical maximum.
  
      if (requestedSize > LIMIT) {
        return false;
      }
  
      var MIN_TOTAL_MEMORY = 16777216;
      var newSize = Math.max(oldSize, MIN_TOTAL_MEMORY); // So the loop below will not be infinite, and minimum asm.js memory size is 16MB.
  
      // TODO: see realloc_buffer - for PTHREADS we may want to decrease these jumps
      while (newSize < requestedSize) { // Keep incrementing the heap size as long as it's less than what is requested.
        if (newSize <= 536870912) {
          newSize = alignUp(2 * newSize, PAGE_MULTIPLE); // Simple heuristic: double until 1GB...
        } else {
          // ..., but after that, add smaller increments towards 2GB, which we cannot reach
          newSize = Math.min(alignUp((3 * newSize + 2147483648) / 4, PAGE_MULTIPLE), LIMIT);
        }
  
      }
  
  
  
      var replacement = emscripten_realloc_buffer(newSize);
      if (!replacement) {
        return false;
      }
  
  
  
      return true;
    } 
embind_init_charCodes();
BindingError = Module['BindingError'] = extendError(Error, 'BindingError');;
InternalError = Module['InternalError'] = extendError(Error, 'InternalError');;
init_ClassHandle();
init_RegisteredPointer();
init_embind();;
UnboundTypeError = Module['UnboundTypeError'] = extendError(Error, 'UnboundTypeError');;
init_emval();;
var ASSERTIONS = false;

// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

/** @type {function(string, boolean=, number=)} */
function intArrayFromString(stringy, dontAddNull, length) {
  var len = length > 0 ? length : lengthBytesUTF8(stringy)+1;
  var u8array = new Array(len);
  var numBytesWritten = stringToUTF8Array(stringy, u8array, 0, u8array.length);
  if (dontAddNull) u8array.length = numBytesWritten;
  return u8array;
}

function intArrayToString(array) {
  var ret = [];
  for (var i = 0; i < array.length; i++) {
    var chr = array[i];
    if (chr > 0xFF) {
      if (ASSERTIONS) {
        assert(false, 'Character code ' + chr + ' (' + String.fromCharCode(chr) + ')  at offset ' + i + ' not in 0x00-0xFF.');
      }
      chr &= 0xFF;
    }
    ret.push(String.fromCharCode(chr));
  }
  return ret.join('');
}


// Copied from https://github.com/strophe/strophejs/blob/e06d027/src/polyfills.js#L149

// This code was written by Tyler Akins and has been placed in the
// public domain.  It would be nice if you left this header intact.
// Base64 code from Tyler Akins -- http://rumkin.com

/**
 * Decodes a base64 string.
 * @param {String} input The string to decode.
 */
var decodeBase64 = typeof atob === 'function' ? atob : function (input) {
  var keyStr = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

  var output = '';
  var chr1, chr2, chr3;
  var enc1, enc2, enc3, enc4;
  var i = 0;
  // remove all characters that are not A-Z, a-z, 0-9, +, /, or =
  input = input.replace(/[^A-Za-z0-9\+\/\=]/g, '');
  do {
    enc1 = keyStr.indexOf(input.charAt(i++));
    enc2 = keyStr.indexOf(input.charAt(i++));
    enc3 = keyStr.indexOf(input.charAt(i++));
    enc4 = keyStr.indexOf(input.charAt(i++));

    chr1 = (enc1 << 2) | (enc2 >> 4);
    chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    chr3 = ((enc3 & 3) << 6) | enc4;

    output = output + String.fromCharCode(chr1);

    if (enc3 !== 64) {
      output = output + String.fromCharCode(chr2);
    }
    if (enc4 !== 64) {
      output = output + String.fromCharCode(chr3);
    }
  } while (i < input.length);
  return output;
};

// Converts a string of base64 into a byte array.
// Throws error on invalid input.
function intArrayFromBase64(s) {
  if (typeof ENVIRONMENT_IS_NODE === 'boolean' && ENVIRONMENT_IS_NODE) {
    var buf;
    try {
      buf = Buffer.from(s, 'base64');
    } catch (_) {
      buf = new Buffer(s, 'base64');
    }
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  try {
    var decoded = decodeBase64(s);
    var bytes = new Uint8Array(decoded.length);
    for (var i = 0 ; i < decoded.length ; ++i) {
      bytes[i] = decoded.charCodeAt(i);
    }
    return bytes;
  } catch (_) {
    throw new Error('Converting base64 string to bytes failed.');
  }
}

// If filename is a base64 data URI, parses and returns data (Buffer on node,
// Uint8Array otherwise). If filename is not a base64 data URI, returns undefined.
function tryParseAsDataURI(filename) {
  if (!isDataURI(filename)) {
    return;
  }

  return intArrayFromBase64(filename.slice(dataURIPrefix.length));
}


// ASM_LIBRARY EXTERN PRIMITIVES: Int8Array,Int32Array


var asmGlobalArg = {};

var asmLibraryArg = {
  "abort": abort,
  "setTempRet0": setTempRet0,
  "getTempRet0": getTempRet0,
  "ClassHandle": ClassHandle,
  "ClassHandle_clone": ClassHandle_clone,
  "ClassHandle_delete": ClassHandle_delete,
  "ClassHandle_deleteLater": ClassHandle_deleteLater,
  "ClassHandle_isAliasOf": ClassHandle_isAliasOf,
  "ClassHandle_isDeleted": ClassHandle_isDeleted,
  "RegisteredClass": RegisteredClass,
  "RegisteredPointer": RegisteredPointer,
  "RegisteredPointer_deleteObject": RegisteredPointer_deleteObject,
  "RegisteredPointer_destructor": RegisteredPointer_destructor,
  "RegisteredPointer_fromWireType": RegisteredPointer_fromWireType,
  "RegisteredPointer_getPointee": RegisteredPointer_getPointee,
  "___gxx_personality_v0": ___gxx_personality_v0,
  "___setErrNo": ___setErrNo,
  "__embind_register_bool": __embind_register_bool,
  "__embind_register_class": __embind_register_class,
  "__embind_register_class_function": __embind_register_class_function,
  "__embind_register_emval": __embind_register_emval,
  "__embind_register_float": __embind_register_float,
  "__embind_register_function": __embind_register_function,
  "__embind_register_integer": __embind_register_integer,
  "__embind_register_memory_view": __embind_register_memory_view,
  "__embind_register_std_string": __embind_register_std_string,
  "__embind_register_std_wstring": __embind_register_std_wstring,
  "__embind_register_void": __embind_register_void,
  "__emval_as": __emval_as,
  "__emval_decref": __emval_decref,
  "__emval_get_property": __emval_get_property,
  "__emval_incref": __emval_incref,
  "__emval_new_cstring": __emval_new_cstring,
  "__emval_register": __emval_register,
  "__emval_run_destructors": __emval_run_destructors,
  "__emval_take_value": __emval_take_value,
  "_abort": _abort,
  "_embind_repr": _embind_repr,
  "_emscripten_get_heap_size": _emscripten_get_heap_size,
  "_emscripten_memcpy_big": _emscripten_memcpy_big,
  "_emscripten_resize_heap": _emscripten_resize_heap,
  "abortOnCannotGrowMemory": abortOnCannotGrowMemory,
  "attachFinalizer": attachFinalizer,
  "constNoSmartPtrRawPointerToWireType": constNoSmartPtrRawPointerToWireType,
  "count_emval_handles": count_emval_handles,
  "craftInvokerFunction": craftInvokerFunction,
  "createNamedFunction": createNamedFunction,
  "demangle": demangle,
  "demangleAll": demangleAll,
  "detachFinalizer": detachFinalizer,
  "downcastPointer": downcastPointer,
  "embind__requireFunction": embind__requireFunction,
  "embind_init_charCodes": embind_init_charCodes,
  "emscripten_realloc_buffer": emscripten_realloc_buffer,
  "ensureOverloadTable": ensureOverloadTable,
  "exposePublicSymbol": exposePublicSymbol,
  "extendError": extendError,
  "floatReadValueFromPointer": floatReadValueFromPointer,
  "flushPendingDeletes": flushPendingDeletes,
  "genericPointerToWireType": genericPointerToWireType,
  "getBasestPointer": getBasestPointer,
  "getInheritedInstance": getInheritedInstance,
  "getInheritedInstanceCount": getInheritedInstanceCount,
  "getLiveInheritedInstances": getLiveInheritedInstances,
  "getShiftFromSize": getShiftFromSize,
  "getStringOrSymbol": getStringOrSymbol,
  "getTypeName": getTypeName,
  "get_first_emval": get_first_emval,
  "heap32VectorToArray": heap32VectorToArray,
  "init_ClassHandle": init_ClassHandle,
  "init_RegisteredPointer": init_RegisteredPointer,
  "init_embind": init_embind,
  "init_emval": init_emval,
  "integerReadValueFromPointer": integerReadValueFromPointer,
  "jsStackTrace": jsStackTrace,
  "makeClassHandle": makeClassHandle,
  "makeLegalFunctionName": makeLegalFunctionName,
  "new_": new_,
  "nonConstNoSmartPtrRawPointerToWireType": nonConstNoSmartPtrRawPointerToWireType,
  "readLatin1String": readLatin1String,
  "registerType": registerType,
  "releaseClassHandle": releaseClassHandle,
  "replacePublicSymbol": replacePublicSymbol,
  "requireHandle": requireHandle,
  "requireRegisteredType": requireRegisteredType,
  "runDestructor": runDestructor,
  "runDestructors": runDestructors,
  "setDelayFunction": setDelayFunction,
  "shallowCopyInternalPointer": shallowCopyInternalPointer,
  "simpleReadValueFromPointer": simpleReadValueFromPointer,
  "stackTrace": stackTrace,
  "throwBindingError": throwBindingError,
  "throwInstanceAlreadyDeleted": throwInstanceAlreadyDeleted,
  "throwInternalError": throwInternalError,
  "throwUnboundTypeError": throwUnboundTypeError,
  "upcastPointer": upcastPointer,
  "whenDependentTypesAreResolved": whenDependentTypesAreResolved,
  "tempDoublePtr": tempDoublePtr,
  "DYNAMICTOP_PTR": DYNAMICTOP_PTR
};
// EMSCRIPTEN_START_ASM
var asm =Module["asm"]// EMSCRIPTEN_END_ASM
(asmGlobalArg, asmLibraryArg, buffer);

var __Z12createModulei = Module["__Z12createModulei"] = asm["__Z12createModulei"];
var ___embind_register_native_and_builtin_types = Module["___embind_register_native_and_builtin_types"] = asm["___embind_register_native_and_builtin_types"];
var ___errno_location = Module["___errno_location"] = asm["___errno_location"];
var ___getTypeName = Module["___getTypeName"] = asm["___getTypeName"];
var __hook_cycle = Module["__hook_cycle"] = asm["__hook_cycle"];
var __hook_init = Module["__hook_init"] = asm["__hook_init"];
var __hook_off = Module["__hook_off"] = asm["__hook_off"];
var __hook_on = Module["__hook_on"] = asm["__hook_on"];
var __hook_param = Module["__hook_param"] = asm["__hook_param"];
var __osc_bl_par_idx = Module["__osc_bl_par_idx"] = asm["__osc_bl_par_idx"];
var __osc_bl_saw_idx = Module["__osc_bl_saw_idx"] = asm["__osc_bl_saw_idx"];
var __osc_bl_sqr_idx = Module["__osc_bl_sqr_idx"] = asm["__osc_bl_sqr_idx"];
var __osc_mcu_hash = Module["__osc_mcu_hash"] = asm["__osc_mcu_hash"];
var __osc_rand = Module["__osc_rand"] = asm["__osc_rand"];
var __osc_white = Module["__osc_white"] = asm["__osc_white"];
var _emscripten_replace_memory = Module["_emscripten_replace_memory"] = asm["_emscripten_replace_memory"];
var _free = Module["_free"] = asm["_free"];
var _malloc = Module["_malloc"] = asm["_malloc"];
var _memcpy = Module["_memcpy"] = asm["_memcpy"];
var _memset = Module["_memset"] = asm["_memset"];
var _osc_api_init = Module["_osc_api_init"] = asm["_osc_api_init"];
var _sbrk = Module["_sbrk"] = asm["_sbrk"];
var establishStackSpace = Module["establishStackSpace"] = asm["establishStackSpace"];
var globalCtors = Module["globalCtors"] = asm["globalCtors"];
var stackAlloc = Module["stackAlloc"] = asm["stackAlloc"];
var stackRestore = Module["stackRestore"] = asm["stackRestore"];
var stackSave = Module["stackSave"] = asm["stackSave"];
var dynCall_ii = Module["dynCall_ii"] = asm["dynCall_ii"];
var dynCall_iii = Module["dynCall_iii"] = asm["dynCall_iii"];
var dynCall_iiii = Module["dynCall_iiii"] = asm["dynCall_iiii"];
var dynCall_iiiii = Module["dynCall_iiiii"] = asm["dynCall_iiiii"];
var dynCall_iiiiii = Module["dynCall_iiiiii"] = asm["dynCall_iiiiii"];
var dynCall_iiiiiii = Module["dynCall_iiiiiii"] = asm["dynCall_iiiiiii"];
var dynCall_v = Module["dynCall_v"] = asm["dynCall_v"];
var dynCall_vi = Module["dynCall_vi"] = asm["dynCall_vi"];
var dynCall_viid = Module["dynCall_viid"] = asm["dynCall_viid"];
var dynCall_viiid = Module["dynCall_viiid"] = asm["dynCall_viiid"];
var dynCall_viiii = Module["dynCall_viiii"] = asm["dynCall_viiii"];
var dynCall_viiiii = Module["dynCall_viiiii"] = asm["dynCall_viiiii"];
var dynCall_viiiiii = Module["dynCall_viiiiii"] = asm["dynCall_viiiiii"];
;



// === Auto-generated postamble setup entry stuff ===

Module['asm'] = asm;















































































var calledRun;


/**
 * @constructor
 * @this {ExitStatus}
 */
function ExitStatus(status) {
  this.name = "ExitStatus";
  this.message = "Program terminated with exit(" + status + ")";
  this.status = status;
}

var calledMain = false;

dependenciesFulfilled = function runCaller() {
  // If run has never been called, and we should call run (INVOKE_RUN is true, and Module.noInitialRun is not false)
  if (!calledRun) run();
  if (!calledRun) dependenciesFulfilled = runCaller; // try this again later, after new deps are fulfilled
};





/** @type {function(Array=)} */
function run(args) {
  args = args || arguments_;

  if (runDependencies > 0) {
    return;
  }


  preRun();

  if (runDependencies > 0) return; // a preRun added a dependency, run will be called later

  function doRun() {
    // run may have just been called through dependencies being fulfilled just in this very frame,
    // or while the async setStatus time below was happening
    if (calledRun) return;
    calledRun = true;

    if (ABORT) return;

    initRuntime();

    preMain();

    if (Module['onRuntimeInitialized']) Module['onRuntimeInitialized']();


    postRun();
  }

  if (Module['setStatus']) {
    Module['setStatus']('Running...');
    setTimeout(function() {
      setTimeout(function() {
        Module['setStatus']('');
      }, 1);
      doRun();
    }, 1);
  } else
  {
    doRun();
  }
}
Module['run'] = run;


function exit(status, implicit) {

  // if this is just main exit-ing implicitly, and the status is 0, then we
  // don't need to do anything here and can just leave. if the status is
  // non-zero, though, then we need to report it.
  // (we may have warned about this earlier, if a situation justifies doing so)
  if (implicit && noExitRuntime && status === 0) {
    return;
  }

  if (noExitRuntime) {
  } else {

    ABORT = true;
    EXITSTATUS = status;

    exitRuntime();

    if (Module['onExit']) Module['onExit'](status);
  }

  quit_(status, new ExitStatus(status));
}

var abortDecorators = [];

function abort(what) {
  if (Module['onAbort']) {
    Module['onAbort'](what);
  }

  what += '';
  out(what);
  err(what);

  ABORT = true;
  EXITSTATUS = 1;

  throw 'abort(' + what + '). Build with -s ASSERTIONS=1 for more info.';
}
Module['abort'] = abort;

if (Module['preInit']) {
  if (typeof Module['preInit'] == 'function') Module['preInit'] = [Module['preInit']];
  while (Module['preInit'].length > 0) {
    Module['preInit'].pop()();
  }
}


  noExitRuntime = true;

run();





// {{MODULE_ADDITIONS}}



